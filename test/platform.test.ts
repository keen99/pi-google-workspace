import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDIRECT_URI,
  EXTENSION_NAME,
  OAUTH_SCOPE,
  fs,
  getConfigDir,
  getConfigPath,
} from "../src/platform.js";

describe("platform configuration", () => {
  it("builds config paths under pi agent directory", () => {
    expect(getConfigDir()).toMatch(/[\\/].pi[\\/]agent[\\/]google-workspace$/);
    expect(getConfigPath()).toMatch(/[\\/].pi[\\/]agent[\\/]google-workspace[\\/]oauth.json$/);
  });

  it("uses loopback OAuth callback", () => {
    const redirect = new URL(DEFAULT_REDIRECT_URI);
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(redirect.pathname).toBe("/oauth2callback");
  });

  it("declares all required Google scopes", () => {
    expect(OAUTH_SCOPE.split(" ")).toEqual([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
  });

  it("exposes expected platform dependencies", () => {
    expect(EXTENSION_NAME).toBe("google-workspace");
    expect(typeof fs.mkdir).toBe("function");
    expect(typeof fs.readFile).toBe("function");
    expect(typeof fs.rm).toBe("function");
    expect(typeof fs.writeFile).toBe("function");
  });
});
