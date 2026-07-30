import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { refreshToken, exchangeCodeForToken, googleRequest, googleBinaryRequest, googleDriveMultipartUpload } from "../index.js";
import type { AuthConfig } from "../src/pure.js";

const validConfig: AuthConfig = {
  clientId: "CID",
  clientSecret: "SEC",
  redirectUri: "http://127.0.0.1:53682/oauth2callback",
  tokens: {
    access_token: "ACCESS",
    refresh_token: "REFRESH",
    token_type: "Bearer",
    scope: "scope-a scope-b",
    expiry_date: Date.now() + 3_600_000,
  },
};

function mockFetchResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => {
      const s = typeof body === "string" ? body : JSON.stringify(body);
      return new TextEncoder().encode(s).buffer;
    },
    headers: new Map(Object.entries(headers)),
  });
}

beforeEach(() => {
  fsMocks.mkdir.mockClear();
  fsMocks.readFile.mockReset();
  fsMocks.writeFile.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshToken", () => {
  it("throws when no refresh_token", async () => {
    const cfg = { ...validConfig, tokens: { ...validConfig.tokens, refresh_token: undefined } };
    await expect(refreshToken(cfg)).rejects.toThrow(/No refresh_token/);
  });

  it("throws on non-ok with error_description", async () => {
    const f = mockFetchResponse(400, { error: "invalid_grant", error_description: "bad refresh" });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(refreshToken(validConfig)).rejects.toThrow("bad refresh");
  });

  it("throws generic on non-ok without description", async () => {
    const f = mockFetchResponse(500, {});
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(refreshToken(validConfig)).rejects.toThrow("Token refresh failed");
  });

  it("throws when access_token not string", async () => {
    const f = mockFetchResponse(200, { access_token: 5 });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(refreshToken(validConfig)).rejects.toThrow("Token refresh failed");
  });

  it("returns updated config + persists", async () => {
    const f = mockFetchResponse(200, { access_token: "NEW", token_type: "Bearer", scope: "s", expires_in: 3600 });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await refreshToken(validConfig);
    expect(out.tokens.access_token).toBe("NEW");
    expect(out.tokens.refresh_token).toBe("REFRESH");
    expect(typeof out.tokens.expiry_date).toBe("number");
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
    // posts to token endpoint with form body
    expect(f).toHaveBeenCalledOnce();
    const call = f.mock.calls[0];
    expect(call[0].toString()).toBe("https://oauth2.googleapis.com/token");
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(call[1].body)).toContain("grant_type=refresh_token");
    expect(String(call[1].body)).toContain("refresh_token=REFRESH");
  });
});

describe("exchangeCodeForToken", () => {
  it("throws on non-ok", async () => {
    const f = mockFetchResponse(400, { error_description: "bad code" });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(
      exchangeCodeForToken({ clientId: "CID", clientSecret: "SEC", redirectUri: "http://x", code: "C" }),
    ).rejects.toThrow("bad code");
  });

  it("throws generic on non-ok without desc", async () => {
    const f = mockFetchResponse(500, {});
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(
      exchangeCodeForToken({ clientId: "CID", clientSecret: "SEC", redirectUri: "http://x", code: "C" }),
    ).rejects.toThrow("Failed to issue token");
  });

  it("returns tokens on success", async () => {
    const f = mockFetchResponse(200, { access_token: "AT", refresh_token: "RT", token_type: "Bearer", scope: "s", expires_in: 100 });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await exchangeCodeForToken({ clientId: "CID", clientSecret: "SEC", redirectUri: "http://x", code: "C" });
    expect(out.access_token).toBe("AT");
    expect(out.refresh_token).toBe("RT");
    expect(out.token_type).toBe("Bearer");
    expect(out.scope).toBe("s");
    expect(typeof out.expiry_date).toBe("number");
  });

  it("defaults missing fields", async () => {
    const f = mockFetchResponse(200, { access_token: "AT" });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await exchangeCodeForToken({ clientId: "CID", clientSecret: "SEC", redirectUri: "http://x", code: "C" });
    expect(out.refresh_token).toBeUndefined();
    expect(out.token_type).toBe("Bearer");
  });
});

describe("googleRequest", () => {
  function seedConfig() {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(validConfig));
  }

  it("GET json path resolves to www.googleapis.com", async () => {
    seedConfig();
    const f = mockFetchResponse(200, { files: [] });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await googleRequest("/drive/v3/files", { query: { pageSize: 5 } });
    const url = f.mock.calls[0][0] as URL;
    expect(url.hostname).toBe("www.googleapis.com");
    expect(url.pathname).toBe("/drive/v3/files");
    expect(url.searchParams.get("pageSize")).toBe("5");
    expect(f.mock.calls[0][1].method).toBe("GET");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer ACCESS");
  });

  it("POST sends json body", async () => {
    seedConfig();
    const f = mockFetchResponse(200, { id: "1" });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await googleRequest("/drive/v3/files", { method: "POST", body: { name: "x" } });
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(f.mock.calls[0][1].body).toBe(JSON.stringify({ name: "x" }));
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
  });

  it("skips undefined query params", async () => {
    seedConfig();
    const f = mockFetchResponse(200, {});
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await googleRequest("/drive/v3/files", { query: { q: "x", pageSize: undefined } });
    const url = f.mock.calls[0][0] as URL;
    expect(url.searchParams.has("pageSize")).toBe(false);
    expect(url.searchParams.get("q")).toBe("x");
  });

  it("refreshes on 401 then retries", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify(validConfig));
    const refreshJson = JSON.stringify({ access_token: "NEW", expires_in: 3600 });
    const err401 = { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "expired" } }), headers: new Map() };
    const ok200 = { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }), headers: new Map() };
    const refreshOk = { ok: true, status: 200, text: async () => refreshJson, headers: new Map() };
    const f = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    // call order: first request 401 -> refresh POST 200 -> retry request 200
    f.mockResolvedValueOnce(err401)
     .mockResolvedValueOnce(refreshOk)
     .mockResolvedValueOnce(ok200);
    const data = await googleRequest("/drive/v3/files");
    expect(data).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    // retry used refreshed token
    expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer NEW");
  });

  it("throws on non-ok with error message", async () => {
    seedConfig();
    const f = mockFetchResponse(403, { error: { message: "rate limited" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(googleRequest("/drive/v3/files")).rejects.toThrow("rate limited");
  });

  it("throws generic on non-ok without message", async () => {
    seedConfig();
    const f = mockFetchResponse(500, {});
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(googleRequest("/drive/v3/files")).rejects.toThrow("Google API error");
  });

  it("routes docs to docs.googleapis.com", async () => {
    seedConfig();
    const f = mockFetchResponse(200, {});
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await googleRequest("/v1/documents/abc");
    expect((f.mock.calls[0][0] as URL).hostname).toBe("docs.googleapis.com");
  });
});

describe("googleBinaryRequest", () => {
  function seedConfig() {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(validConfig));
  }

  it("returns bytes + content-type", async () => {
    seedConfig();
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
      headers: new Map([["content-type", "application/pdf"]]),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await googleBinaryRequest("/drive/v3/files/1", { query: { alt: "media" } });
    expect(out.contentType).toBe("application/pdf");
    expect(out.bytes.byteLength).toBe(5);
  });

  it("throws on non-ok", async () => {
    seedConfig();
    const f = mockFetchResponse(404, { error: { message: "not found" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(googleBinaryRequest("/drive/v3/files/x")).rejects.toThrow("not found");
  });

  it("defaults content-type to octet-stream when missing", async () => {
    seedConfig();
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
      arrayBuffer: async () => new Uint8Array().buffer,
      headers: new Map(),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await googleBinaryRequest("/drive/v3/files/1");
    expect(out.contentType).toBe("application/octet-stream");
  });
});

describe("googleDriveMultipartUpload", () => {
  function seedConfig() {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(validConfig));
  }

  it("posts multipart body + returns parsed", async () => {
    seedConfig();
    const f = mockFetchResponse(200, { id: "FILEID", name: "x" });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = await googleDriveMultipartUpload({ name: "x" }, new TextEncoder().encode("data"), "text/plain");
    expect(out.id).toBe("FILEID");
    const url = f.mock.calls[0][0] as URL;
    expect(url.hostname).toBe("www.googleapis.com");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(f.mock.calls[0][1].headers["Content-Type"]).toContain("multipart/related; boundary=pi-boundary-");
    expect(f.mock.calls[0][1].body).toBeInstanceOf(Buffer);
  });

  it("throws on non-ok", async () => {
    seedConfig();
    const f = mockFetchResponse(500, { error: { message: "upload failed" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await expect(googleDriveMultipartUpload({ name: "x" }, new Uint8Array(), "text/plain")).rejects.toThrow("upload failed");
  });
});
