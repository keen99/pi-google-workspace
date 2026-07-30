import { describe, it, expect } from "vitest";
import {
  parseJson,
  isExpired,
  resolveGoogleApiUrl,
  safeFilename,
  normalizeOutputPath,
  normalizeText,
  escapeMdInline,
  escapeMdTableCell,
} from "../src/pure.js";

describe("parseJson", () => {
  it("parses valid json object", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns empty object on invalid json", () => {
    expect(parseJson("not json")).toEqual({});
  });
  it("returns empty object on empty string", () => {
    expect(parseJson("")).toEqual({});
  });
  it("parses array into object? no, JSON.parse array returned as-is", () => {
    // array is valid json; parseJson casts to JsonMap but value is array
    const out = parseJson("[1,2,3]");
    // cast happens at type level; runtime is array
    expect(Array.isArray(out)).toBe(true);
  });
});

describe("isExpired", () => {
  it("returns false when no expiry_date", () => {
    expect(isExpired({ access_token: "x" })).toBe(false);
  });
  it("returns false when expiry in future beyond 60s buffer", () => {
    expect(isExpired({ access_token: "x", expiry_date: Date.now() + 120_000 })).toBe(false);
  });
  it("returns true when expiry in past", () => {
    expect(isExpired({ access_token: "x", expiry_date: Date.now() - 1000 })).toBe(true);
  });
  it("returns true when within 60s buffer", () => {
    expect(isExpired({ access_token: "x", expiry_date: Date.now() + 30_000 })).toBe(true);
  });
  it("returns true at exactly buffer boundary", () => {
    const expiry = Date.now() + 60_000;
    // now >= expiry - 60000 -> now >= now -> true
    expect(isExpired({ access_token: "x", expiry_date: expiry })).toBe(true);
  });
});

describe("resolveGoogleApiUrl", () => {
  it("routes docs to docs.googleapis.com", () => {
    expect(resolveGoogleApiUrl("/v1/documents/abc").hostname).toBe("docs.googleapis.com");
  });
  it("routes presentations to slides.googleapis.com", () => {
    expect(resolveGoogleApiUrl("/v1/presentations/abc").hostname).toBe("slides.googleapis.com");
  });
  it("routes spreadsheets to sheets.googleapis.com", () => {
    expect(resolveGoogleApiUrl("/v4/spreadsheets/abc").hostname).toBe("sheets.googleapis.com");
  });
  it("routes drive to www.googleapis.com", () => {
    expect(resolveGoogleApiUrl("/drive/v3/files").hostname).toBe("www.googleapis.com");
  });
  it("preserves path", () => {
    expect(resolveGoogleApiUrl("/v1/documents/abc").pathname).toBe("/v1/documents/abc");
  });
});

describe("safeFilename", () => {
  it("replaces forbidden chars with underscore", () => {
    expect(safeFilename('a\\b/c:d*e?f"g<h>i|')).toBe("a_b_c_d_e_f_g_h_i_");
  });
  it("collapses whitespace", () => {
    expect(safeFilename("a   b\tc")).toBe("a b c");
  });
  it("trims", () => {
    expect(safeFilename("  name  ")).toBe("name");
  });
  it("truncates to 120 chars", () => {
    expect(safeFilename("x".repeat(200)).length).toBe(120);
  });
  it("returns document when result empty", () => {
    expect(safeFilename("   ")).toBe("document");
  });
});

describe("normalizeOutputPath", () => {
  it("uses fallback when no output", () => {
    expect(normalizeOutputPath("/cwd", undefined, "f.txt")).toBe("/cwd/f.txt");
  });
  it("uses fallback when blank output", () => {
    expect(normalizeOutputPath("/cwd", "   ", "f.txt")).toBe("/cwd/f.txt");
  });
  it("uses output when provided", () => {
    expect(normalizeOutputPath("/cwd", "out.txt", "f.txt")).toBe("/cwd/out.txt");
  });
  it("strips leading @", () => {
    expect(normalizeOutputPath("/cwd", "@/sub/f.txt", "f.txt")).toBe("/sub/f.txt");
  });
  it("relative output resolves against cwd", () => {
    expect(normalizeOutputPath("/cwd", "sub/f.txt", "f.txt")).toBe("/cwd/sub/f.txt");
  });
});

describe("normalizeText", () => {
  it("converts crlf to lf", () => {
    expect(normalizeText("a\r\nb")).toBe("a\nb");
  });
  it("converts vertical tab to lf", () => {
    expect(normalizeText("a\u000bb")).toBe("a\nb");
  });
  it("leaves plain text", () => {
    expect(normalizeText("abc")).toBe("abc");
  });
});

describe("escapeMdInline", () => {
  it("escapes backslash", () => {
    expect(escapeMdInline("a\\b")).toBe("a\\\\b");
  });
  it("escapes backtick", () => {
    expect(escapeMdInline("a`b")).toBe("a\\`b");
  });
  it("escapes pipe", () => {
    expect(escapeMdInline("a|b")).toBe("a\\|b");
  });
  it("leaves plain text", () => {
    expect(escapeMdInline("abc")).toBe("abc");
  });
});

describe("escapeMdTableCell", () => {
  it("escapes pipe", () => {
    expect(escapeMdTableCell("a|b")).toBe("a\\|b");
  });
  it("converts newline to br", () => {
    expect(escapeMdTableCell("a\nb")).toBe("a<br>b");
  });
});
