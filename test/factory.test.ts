import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/platform.js", () => ({
  EXTENSION_NAME: "google-workspace",
  DEFAULT_REDIRECT_URI: "http://127.0.0.1:53682/oauth2callback",
  OAUTH_SCOPE: "scope-a scope-b",
  getConfigDir: () => "/fake/home/.pi/agent/google-workspace",
  getConfigPath: () => "/fake/home/.pi/agent/google-workspace/oauth.json",
  fs: fsMocks,
  homedir: () => "/fake/home",
}));

import googleWorkspaceExtension from "../index.js";

type RegisteredTool = {
  name: string;
  label?: string;
  description: string;
  execute: (...args: never[]) => Promise<unknown>;
};
type RegisteredCommand = { name: string; description: string; handler: (...args: never[]) => Promise<unknown> };

function fakePi(): {
  pi: ExtensionAPI;
  tools: RegisteredTool[];
  commands: RegisteredCommand[];
  events: Map<string, (...args: unknown[]) => unknown>;
  execCalls: { cmd: string; args: string[] }[];
} {
  const tools: RegisteredTool[] = [];
  const commands: RegisteredCommand[] = [];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const execCalls: { cmd: string; args: string[] }[] = [];
  const pi = {
    registerTool: (t: RegisteredTool) => tools.push(t),
    registerCommand: (name: string, opts: Omit<RegisteredCommand, "name">) =>
      commands.push({ name, ...opts }),
    on: (ev: string, fn: (...a: unknown[]) => unknown) => events.set(ev, fn),
    exec: async (cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
    },
  } as unknown as ExtensionAPI;
  return { pi, tools, commands, events, execCalls };
}

beforeEach(() => {
  fsMocks.readFile.mockReset();
  fsMocks.writeFile.mockClear();
  fsMocks.rm.mockClear();
});

describe("extension registration", () => {
  it("registers 2 commands", () => {
    const { pi, commands } = fakePi();
    googleWorkspaceExtension(pi);
    expect(commands.map((c) => c.name).sort()).toEqual(["gws-logout", "gws-setup"]);
  });

  it("registers 20 tools", () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    expect(tools.length).toBe(20);
  });

  const expectedTools = [
    "google_workspace_status",
    "google_drive_list",
    "google_drive_download",
    "google_drive_upload",
    "google_drive_create_folder",
    "google_sheets_create",
    "google_sheets_read",
    "google_sheets_list_tabs",
    "google_sheets_update_values",
    "google_sheets_batch_update",
    "google_sheets_add_chart",
    "google_sheets_list_objects",
    "google_sheets_read_format",
    "google_docs_read",
    "google_docs_create",
    "google_docs_replace_all_text",
    "google_docs_append_text",
    "google_docs_download",
    "google_slides_read",
    "google_slides_replace_text",
  ];

  it("registers all expected tool names", () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    const names = tools.map((t) => t.name).sort();
    for (const n of expectedTools) {
      expect(names, `missing tool: ${n}`).toContain(n);
    }
  });

  it("every tool has description + execute fn", () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    for (const t of tools) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("registers session_start handler", () => {
    const { pi, events } = fakePi();
    googleWorkspaceExtension(pi);
    expect(events.has("session_start")).toBe(true);
  });

  it("session_start calls ui.setStatus", async () => {
    const { pi, events } = fakePi();
    googleWorkspaceExtension(pi);
    const setStatus = vi.fn();
    const ctx = { ui: { setStatus } } as unknown as Record<string, unknown>;
    await (events.get("session_start") as (...a: unknown[]) => unknown)({} as never, ctx);
    expect(setStatus).toHaveBeenCalledOnce();
  });
});

describe("tool: google_workspace_status", () => {
  it("not configured when no config", async () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const status = tools.find((t) => t.name === "google_workspace_status")!;
    const out = (await status.execute()) as { content: { text: string }[]; details: { configured: boolean } };
    expect(out.details.configured).toBe(false);
    expect(out.content[0].text).toContain("Not configured");
  });

  it("configured when config present", async () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        clientId: "CID",
        clientSecret: "SEC",
        redirectUri: "http://x",
        tokens: { access_token: "A", refresh_token: "R", expiry_date: Date.now() + 100000 },
      }),
    );
    const status = tools.find((t) => t.name === "google_workspace_status")!;
    const out = (await status.execute()) as { details: { configured: boolean; refreshToken: boolean } };
    expect(out.details.configured).toBe(true);
    expect(out.details.refreshToken).toBe(true);
  });
});

describe("tool: google_drive_download rejects native files", () => {
  it("throws on google-native mime", async () => {
    const { pi, tools } = fakePi();
    googleWorkspaceExtension(pi);
    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        clientId: "CID",
        clientSecret: "SEC",
        redirectUri: "http://x",
        tokens: { access_token: "A", refresh_token: "R", expiry_date: Date.now() + 100000 },
      }),
    );
    const dl = tools.find((t) => t.name === "google_drive_download")!;
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "1", name: "Doc", mimeType: "application/vnd.google-apps.document" }),
      headers: new Map(),
    } as unknown as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect((dl.execute as (...a: unknown[]) => Promise<unknown>)("t1", { fileId: "1" })).rejects.toThrow(/Google-native file type/);
  });
});
