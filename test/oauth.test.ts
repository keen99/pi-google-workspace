import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/platform.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/platform.js")>();
  return {
    ...original,
    getConfigDir: () => "/fake/google-workspace",
    getConfigPath: () => "/fake/google-workspace/oauth.json",
    fs: fsMocks,
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: fsMocks.mkdir,
  readFile: fsMocks.readFile,
  rm: fsMocks.rm,
  writeFile: fsMocks.writeFile,
}));

import googleWorkspaceExtension, { openBrowser, waitForAuthCode, type ExtensionDependencies } from "../index.js";

const originalFetch = globalThis.fetch;

function callbackServer(path: string, state = "STATE", timeoutMs = 1000) {
  let reportPort!: (port: number) => void;
  const listening = new Promise<number>((resolve) => { reportPort = resolve; });
  const result = waitForAuthCode(`http://127.0.0.1:0${path}`, state, timeoutMs, reportPort);
  return { listening, result };
}

async function occupyPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

function commandHarness(
  inputs: Array<string | undefined> = [],
  confirms: boolean[] = [],
  dependencies: ExtensionDependencies = {},
) {
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const notifications: Array<[string, string]> = [];
  const exec = vi.fn().mockResolvedValue(undefined);
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, options),
    registerTool: () => undefined,
    on: () => undefined,
    exec,
  } as unknown as ExtensionAPI;
  googleWorkspaceExtension(pi, dependencies);
  const ctx = {
    ui: {
      input: vi.fn().mockImplementation(async () => inputs.shift()),
      confirm: vi.fn().mockImplementation(async () => confirms.shift() ?? false),
      notify: vi.fn().mockImplementation((message: string, level: string) => notifications.push([message, level])),
      setStatus: vi.fn(),
    },
  };
  return { commands, ctx, exec, notifications };
}

beforeEach(() => {
  fsMocks.mkdir.mockClear();
  fsMocks.readFile.mockReset();
  fsMocks.rm.mockReset().mockResolvedValue(undefined);
  fsMocks.writeFile.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitForAuthCode", () => {
  it("returns code from valid loopback callback", async () => {
    const callbackServerState = callbackServer("/oauth2callback");
    const port = await callbackServerState.listening;
    const callback = await originalFetch(`http://127.0.0.1:${port}/oauth2callback?state=STATE&code=CODE`);
    expect(callback.status).toBe(200);
    expect(await callbackServerState.result).toBe("CODE");
  });

  it("returns 404 for wrong path and remains ready for valid callback", async () => {
    const callbackServerState = callbackServer("/oauth2callback");
    const port = await callbackServerState.listening;
    expect((await originalFetch(`http://127.0.0.1:${port}/wrong`)).status).toBe(404);
    await originalFetch(`http://127.0.0.1:${port}/oauth2callback?state=STATE&code=CODE`);
    await expect(callbackServerState.result).resolves.toBe("CODE");
  });

  it("rejects provider error", async () => {
    const callbackServerState = callbackServer("/cb");
    const port = await callbackServerState.listening;
    const rejection = expect(callbackServerState.result).rejects.toThrow("OAuth error: access_denied");
    await originalFetch(`http://127.0.0.1:${port}/cb?error=access_denied`);
    await rejection;
  });

  it("rejects missing code or wrong state", async () => {
    const callbackServerState = callbackServer("/cb");
    const port = await callbackServerState.listening;
    const rejection = expect(callbackServerState.result).rejects.toThrow("Failed to validate state");
    await originalFetch(`http://127.0.0.1:${port}/cb?state=WRONG`);
    await rejection;
  });

  it("rejects malformed callback request", async () => {
    const callbackServerState = callbackServer("/cb");
    const port = await callbackServerState.listening;
    const rejection = expect(callbackServerState.result).rejects.toThrow();
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.end("GET /cb HTTP/1.1\r\nHost: %\r\nConnection: close\r\n\r\n");
        resolve();
      });
      socket.on("error", reject);
    });
    await rejection;
  });

  it("rejects timeout", async () => {
    const callbackServerState = callbackServer("/cb", "STATE", 5);
    await callbackServerState.listening;
    await expect(callbackServerState.result).rejects.toThrow("timed out");
  });

  it("rejects when callback port is occupied", async () => {
    const occupied = await occupyPort();
    try {
      await expect(waitForAuthCode(`http://127.0.0.1:${occupied.port}/cb`, "STATE", 1000)).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await closeServer(occupied.server);
    }
  });
});

describe("openBrowser", () => {
  it.each([
    ["darwin", "open", ["https://example.test"]],
    ["win32", "cmd", ["/c", "start", "", "https://example.test"]],
    ["linux", "xdg-open", ["https://example.test"]],
  ])("uses platform command on %s", async (platform, command, args) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform);
    const exec = vi.fn().mockResolvedValue(undefined);
    await openBrowser({ exec } as unknown as ExtensionAPI, "https://example.test");
    expect(exec).toHaveBeenCalledWith(command, args);
  });
});

describe("OAuth commands", () => {
  it("stops when existing configuration overwrite is declined", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ clientId: "C", clientSecret: "S", redirectUri: "http://127.0.0.1/cb", tokens: { access_token: "A" } }));
    const h = commandHarness([], [false]);
    await h.commands.get("gws-setup")!.handler("", h.ctx);
    expect(h.ctx.ui.input).not.toHaveBeenCalled();
  });

  it.each([
    [[undefined], "client ID cancellation"],
    [["CID", undefined], "client secret cancellation"],
  ])("stops cleanly on %s", async (inputs) => {
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"));
    const h = commandHarness(inputs as Array<string | undefined>);
    await h.commands.get("gws-setup")!.handler("", h.ctx);
    expect(h.exec).not.toHaveBeenCalled();
  });

  it.each([
    ["not a url", "format is invalid"],
    ["https://127.0.0.1/cb", "must use http"],
    ["ftp://127.0.0.1/cb", "must use http"],
    ["http://0.0.0.0:53682/cb", "must use a loopback host"],
  ])("rejects unsafe redirect URI %s", async (redirectUri, message) => {
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"));
    const h = commandHarness(["CID", "SECRET", redirectUri]);
    await h.commands.get("gws-setup")!.handler("", h.ctx);
    expect(h.notifications.some(([text, level]) => text.includes(message) && level === "error")).toBe(true);
    expect(h.exec).not.toHaveBeenCalled();
  });

  it("completes browser callback, exchanges code, and saves credentials", async () => {
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"));
    const callback = vi.fn().mockResolvedValue("AUTH_CODE");
    const redirectUri = "http://127.0.0.1:53682/cb";
    const h = commandHarness([" CID ", " SECRET ", redirectUri], [], { waitForAuthCode: callback });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(200, { access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600 }),
    );

    await h.commands.get("gws-setup")!.handler("", h.ctx);

    expect(callback).toHaveBeenCalledWith(redirectUri, expect.any(String));
    expect(h.exec).toHaveBeenCalledOnce();
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
    const saved = JSON.parse(fsMocks.writeFile.mock.calls[0][1]);
    expect(saved.clientId).toBe("CID");
    expect(saved.clientSecret).toBe("SECRET");
    expect(saved.tokens.refresh_token).toBe("REFRESH");
    expect(h.notifications.some(([text]) => text.includes("Configuration saved"))).toBe(true);
  });

  it("falls back to manual code and preserves existing refresh token", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ clientId: "OLD", clientSecret: "OLD", redirectUri: "http://127.0.0.1/cb", tokens: { access_token: "OLD", refresh_token: "OLD_REFRESH" } }));
    const callback = vi.fn().mockRejectedValue(new Error("callback unavailable"));
    const redirectUri = "http://127.0.0.1:53682/cb";
    const h = commandHarness(["CID", "SECRET", redirectUri, " MANUAL_CODE "], [true], { waitForAuthCode: callback });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(200, { access_token: "NEW", expires_in: 3600 }));

    await h.commands.get("gws-setup")!.handler("", h.ctx);

    const saved = JSON.parse(fsMocks.writeFile.mock.calls[0][1]);
    expect(saved.tokens.refresh_token).toBe("OLD_REFRESH");
    expect(h.notifications.some(([text]) => text.includes("Automatic callback failed"))).toBe(true);
  });

  it("reports browser and token exchange failure", async () => {
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"));
    const callback = vi.fn().mockRejectedValue(new Error("callback unavailable"));
    const h = commandHarness(["CID", "SECRET", "http://127.0.0.1:53682/cb", "CODE"], [], { waitForAuthCode: callback });
    h.exec.mockRejectedValue(new Error("browser unavailable"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(400, { error_description: "invalid code" }));
    await h.commands.get("gws-setup")!.handler("", h.ctx);
    expect(h.notifications.some(([text]) => text.includes("Failed to open browser"))).toBe(true);
    expect(h.notifications.some(([text, level]) => text.includes("invalid code") && level === "error")).toBe(true);
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
  });

  it("cancels logout", async () => {
    const h = commandHarness([], [false]);
    await h.commands.get("gws-logout")!.handler("", h.ctx);
    expect(fsMocks.rm).not.toHaveBeenCalled();
  });

  it("deletes credentials", async () => {
    const h = commandHarness([], [true]);
    await h.commands.get("gws-logout")!.handler("", h.ctx);
    expect(fsMocks.rm).toHaveBeenCalledWith("/fake/google-workspace/oauth.json", { force: true });
    expect(h.notifications).toContainEqual(["Credentials deleted.", "info"]);
  });

  it("reports credential deletion failure", async () => {
    fsMocks.rm.mockRejectedValue(new Error("permission denied"));
    const h = commandHarness([], [true]);
    await h.commands.get("gws-logout")!.handler("", h.ctx);
    expect(h.notifications).toContainEqual(["Deletion failed: permission denied", "error"]);
  });
});
