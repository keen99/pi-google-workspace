import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock platform.fs + path functions so IO tests never touch real disk.
// vi.hoisted lifts refs above vi.mock hoisting so the factory can see them.
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

const sampleConfig = {
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

import { readConfig, saveConfig, getValidConfig } from "../index.js";

describe("readConfig", () => {
  beforeEach(() => fsMocks.readFile.mockReset());
  it("returns null when file missing", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await readConfig()).toBeNull();
  });
  it("returns null when json invalid", async () => {
    fsMocks.readFile.mockResolvedValueOnce("not json");
    expect(await readConfig()).toBeNull();
  });
  it("returns null when required fields missing", async () => {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify({ clientId: "x" }));
    expect(await readConfig()).toBeNull();
  });
  it("returns parsed config when valid", async () => {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(sampleConfig));
    expect(await readConfig()).toEqual(sampleConfig);
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    fsMocks.mkdir.mockClear();
    fsMocks.writeFile.mockClear();
  });
  it("writes config json with 0600 mode", async () => {
    await saveConfig(sampleConfig);
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "/fake/home/.pi/agent/google-workspace",
      { recursive: true },
    );
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/fake/home/.pi/agent/google-workspace/oauth.json",
      JSON.stringify(sampleConfig, null, 2),
      { mode: 0o600 },
    );
  });
});

describe("getValidConfig", () => {
  beforeEach(() => {
    fsMocks.readFile.mockReset();
    fsMocks.writeFile.mockClear();
  });
  it("throws when no config", async () => {
    fsMocks.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(getValidConfig()).rejects.toThrow(/credentials not found/);
  });
  it("returns config when token valid", async () => {
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(sampleConfig));
    expect(await getValidConfig()).toEqual(sampleConfig);
  });

  it("refreshes and saves an expired token", async () => {
    const expired = {
      ...sampleConfig,
      tokens: { ...sampleConfig.tokens, expiry_date: Date.now() - 1 },
    };
    fsMocks.readFile.mockResolvedValueOnce(JSON.stringify(expired));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "NEW", expires_in: 3600 }),
    } as Response);

    const result = await getValidConfig();

    expect(result.tokens.access_token).toBe("NEW");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
  });
});
