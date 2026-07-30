import { describe, it, expect } from "vitest";
import {
  sheetValuesToText,
  getDocEndIndex,
  extractDocText,
  getDocInsertIndex,
  extractSlidesText,
  authUrl,
} from "../src/pure.js";
import type { JsonMap } from "../src/pure.js";

const SCOPE = "a b c";

describe("sheetValuesToText", () => {
  it("no data on empty", () => {
    expect(sheetValuesToText([])).toBe("(no data)");
  });
  it("no data on non-array", () => {
    expect(sheetValuesToText(undefined as unknown as never[][])).toBe("(no data)");
  });
  it("single cell", () => {
    expect(sheetValuesToText([["x"]])).toBe("x");
  });
  it("tabs between cols, newline between rows", () => {
    expect(sheetValuesToText([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td");
  });
  it("null cells become empty string", () => {
    expect(sheetValuesToText([[null, "x"]])).toBe("\tx");
  });
  it("non-array row becomes empty string", () => {
    expect(sheetValuesToText([["ok"], "bad" as unknown as never[]])).toBe("ok\n");
  });
});

describe("getDocEndIndex", () => {
  it("1 when no body", () => {
    expect(getDocEndIndex({})).toBe(1);
  });
  it("1 when empty body content", () => {
    expect(getDocEndIndex({ body: { content: [] } })).toBe(1);
  });
  it("returns last block endIndex", () => {
    const doc = { body: { content: [{ endIndex: 5 }, { endIndex: 42 }] } } as JsonMap;
    expect(getDocEndIndex(doc)).toBe(42);
  });
  it("falls back to 1 when endIndex missing", () => {
    const doc = { body: { content: [{}] } } as JsonMap;
    expect(getDocEndIndex(doc)).toBe(1);
  });
  it("clamps to minimum 1", () => {
    const doc = { body: { content: [{ endIndex: 0 }] } } as JsonMap;
    expect(getDocEndIndex(doc)).toBe(1);
  });
});

describe("extractDocText", () => {
  it("empty when no body", () => {
    expect(extractDocText({})).toBe("");
  });
  it("joins textRun content across blocks", () => {
    const doc = {
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: "a" } }, { textRun: { content: "b" } }] } },
          { paragraph: { elements: [{ textRun: { content: "c" } }] } },
        ],
      },
    } as JsonMap;
    expect(extractDocText(doc)).toBe("abc");
  });
  it("skips non-string content", () => {
    const doc = { body: { content: [{ paragraph: { elements: [{ textRun: { content: 9 } }, { textRun: { content: "x" } }] } }] } } as JsonMap;
    expect(extractDocText(doc)).toBe("x");
  });
  it("skips blocks without paragraph", () => {
    const doc = { body: { content: [{ table: {} }, { paragraph: { elements: [{ textRun: { content: "y" } }] } }] } } as JsonMap;
    expect(extractDocText(doc)).toBe("y");
  });
});

describe("getDocInsertIndex", () => {
  it("1 when no body", () => {
    expect(getDocInsertIndex({})).toBe(1);
  });
  it("endIndex - 1", () => {
    const doc = { body: { content: [{ endIndex: 50 }] } } as JsonMap;
    expect(getDocInsertIndex(doc)).toBe(49);
  });
  it("clamps to minimum 1", () => {
    const doc = { body: { content: [{ endIndex: 1 }] } } as JsonMap;
    expect(getDocInsertIndex(doc)).toBe(1);
  });
  it("endIndex 0 clamps to 1", () => {
    const doc = { body: { content: [{ endIndex: 0 }] } } as JsonMap;
    expect(getDocInsertIndex(doc)).toBe(1);
  });
});

describe("extractSlidesText", () => {
  it("empty array when no slides", () => {
    expect(extractSlidesText({})).toEqual([]);
  });
  it("extracts text from shape textElements", () => {
    const pres = {
      slides: [
        { objectId: "s1", pageElements: [{ shape: { text: { textElements: [{ textRun: { content: "hello" } }] } } }] },
      ],
    } as JsonMap;
    const out = extractSlidesText(pres);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ slideId: "s1", index: 1, text: "hello" });
  });
  it("uses fallback slideId when objectId missing", () => {
    const pres = { slides: [{}] } as JsonMap;
    expect(extractSlidesText(pres)[0].slideId).toBe("slide-1");
  });
  it("index is 1-based", () => {
    const pres = { slides: [{}, {}] } as JsonMap;
    const out = extractSlidesText(pres);
    expect(out[0].index).toBe(1);
    expect(out[1].index).toBe(2);
  });
  it("skips pageElements without shape text", () => {
    const pres = { slides: [{ objectId: "s1", pageElements: [{ shape: {} }, { other: {} }] }] } as JsonMap;
    expect(extractSlidesText(pres)[0].text).toBe("");
  });
});

describe("authUrl", () => {
  it("builds correct base + params", () => {
    const url = authUrl({ clientId: "CID", redirectUri: "http://127.0.0.1:53682/cb", state: "ST" }, SCOPE);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("CID");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:53682/cb");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(SCOPE);
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("state")).toBe("ST");
  });
  it("encodes special chars in state", () => {
    const url = authUrl({ clientId: "CID", redirectUri: "http://x/cb", state: "a b&c" }, SCOPE);
    expect(new URL(url).searchParams.get("state")).toBe("a b&c");
  });
});
