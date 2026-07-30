import { describe, it, expect } from "vitest";
import {
  applyInlineStyle,
  paragraphTextFromElements,
  isOrderedGlyph,
  getHeadingPrefix,
  tableToMarkdown,
  blockToMarkdown,
  toMarkdownFromDocument,
} from "../src/pure.js";
import type { JsonMap } from "../src/pure.js";

describe("applyInlineStyle", () => {
  it("returns empty on empty text", () => {
    expect(applyInlineStyle("", undefined)).toBe("");
  });
  it("returns escaped plain when no style", () => {
    expect(applyInlineStyle("hi", undefined)).toBe("hi");
  });
  it("wraps bold", () => {
    expect(applyInlineStyle("hi", { bold: true })).toBe("**hi**");
  });
  it("wraps italic", () => {
    expect(applyInlineStyle("hi", { italic: true })).toBe("*hi*");
  });
  it("wraps strikethrough", () => {
    expect(applyInlineStyle("hi", { strikethrough: true })).toBe("~~hi~~");
  });
  it("wraps link", () => {
    expect(applyInlineStyle("hi", { link: { url: "http://x" } })).toBe("[hi](http://x)");
  });
  it("stacks bold+italic+link", () => {
    expect(applyInlineStyle("hi", { bold: true, italic: true, link: { url: "http://x" } })).toBe("[***hi***](http://x)");
  });
  it("escapes inner markdown", () => {
    expect(applyInlineStyle("a_b", { bold: true })).toBe("**a\\_b**");
  });
  it("preserves surrounding whitespace", () => {
    expect(applyInlineStyle("  hi  ", { bold: true })).toBe("  **hi**  ");
  });
  it("handles whitespace-only trimmed to empty -> escaped raw", () => {
    expect(applyInlineStyle("   ", undefined)).toBe("   ");
  });
});

describe("paragraphTextFromElements", () => {
  it("returns empty when no array", () => {
    expect(paragraphTextFromElements(undefined)).toBe("");
  });
  it("joins textRun contents", () => {
    const els = [{ textRun: { content: "a" } }, { textRun: { content: "b" } }] as JsonMap[];
    expect(paragraphTextFromElements(els)).toBe("ab");
  });
  it("skips non-string content", () => {
    const els = [{ textRun: { content: 5 } }, { textRun: { content: "b" } }] as JsonMap[];
    expect(paragraphTextFromElements(els)).toBe("b");
  });
  it("applies style", () => {
    const els = [{ textRun: { content: "hi", textStyle: { bold: true } } }] as JsonMap[];
    expect(paragraphTextFromElements(els)).toBe("**hi**");
  });
  it("trims trailing newlines", () => {
    const els = [{ textRun: { content: "hi\n\n" } }] as JsonMap[];
    expect(paragraphTextFromElements(els)).toBe("hi");
  });
});

describe("isOrderedGlyph", () => {
  it("false on undefined", () => {
    expect(isOrderedGlyph(undefined)).toBe(false);
  });
  it("true on DECIMAL", () => {
    expect(isOrderedGlyph("DECIMAL")).toBe(true);
  });
  it("true on ALPHA", () => {
    expect(isOrderedGlyph("ALPHA")).toBe(true);
  });
  it("true on ROMAN", () => {
    expect(isOrderedGlyph("ROMAN")).toBe(true);
  });
  it("false on unordered glyph", () => {
    expect(isOrderedGlyph("BULLET")).toBe(false);
  });
  it("substring match works", () => {
    expect(isOrderedGlyph("DECIMAL_ALPHA")).toBe(true);
  });
});

describe("getHeadingPrefix", () => {
  it("empty on undefined", () => {
    expect(getHeadingPrefix(undefined)).toBe("");
  });
  it("TITLE -> #", () => {
    expect(getHeadingPrefix("TITLE")).toBe("#");
  });
  it("SUBTITLE -> ##", () => {
    expect(getHeadingPrefix("SUBTITLE")).toBe("##");
  });
  it("HEADING_1 -> #", () => {
    expect(getHeadingPrefix("HEADING_1")).toBe("#");
  });
  it("HEADING_6 -> ######", () => {
    expect(getHeadingPrefix("HEADING_6")).toBe("######");
  });
  it("HEADING_7 -> empty (out of range)", () => {
    expect(getHeadingPrefix("HEADING_7")).toBe("");
  });
  it("NORMAL_TEXT -> empty", () => {
    expect(getHeadingPrefix("NORMAL_TEXT")).toBe("");
  });
});

describe("tableToMarkdown", () => {
  it("empty when no rows", () => {
    expect(tableToMarkdown({}, undefined)).toBe("");
  });
  it("renders header + divider + body", () => {
    const table = {
      tableRows: [
        { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "H1" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "H2" } }] } }] }] },
        { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "a" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "b" } }] } }] }] },
      ],
    } as JsonMap;
    const out = tableToMarkdown(table, undefined);
    expect(out).toBe("| H1 | H2 |\n| --- | --- |\n| a | b |");
  });
  it("pads ragged rows", () => {
    const table = {
      tableRows: [
        { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "H1" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "H2" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "H3" } }] } }] }] },
        { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "a" } }] } }] }] },
      ],
    } as JsonMap;
    const out = tableToMarkdown(table, undefined);
    expect(out).toBe("| H1 | H2 | H3 |\n| --- | --- | --- |\n| a |  |  |");
  });
  it("header only, no body", () => {
    const table = {
      tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "H1" } }] } }] }] }],
    } as JsonMap;
    const out = tableToMarkdown(table, undefined);
    expect(out).toBe("| H1 |\n| --- |");
  });
});

describe("blockToMarkdown", () => {
  it("heading paragraph", () => {
    const block = { paragraph: { elements: [{ textRun: { content: "Title" } }], paragraphStyle: { namedStyleType: "HEADING_1" } } } as JsonMap;
    expect(blockToMarkdown(block, undefined)).toBe("# Title");
  });
  it("plain paragraph", () => {
    const block = { paragraph: { elements: [{ textRun: { content: "body" } }] } } as JsonMap;
    expect(blockToMarkdown(block, undefined)).toBe("body");
  });
  it("unordered bullet", () => {
    const lists = { l1: { listProperties: { nestingLevels: [{ glyphType: "BULLET" }] } } } as JsonMap;
    const block = { paragraph: { elements: [{ textRun: { content: "item" } }], bullet: { listId: "l1", nestingLevel: 0 } } } as JsonMap;
    expect(blockToMarkdown(block, lists)).toBe("- item");
  });
  it("ordered bullet with numbering state", () => {
    const lists = { l1: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } } } as JsonMap;
    const state = new Map<string, number>();
    const b1 = { paragraph: { elements: [{ textRun: { content: "one" } }], bullet: { listId: "l1", nestingLevel: 0 } } } as JsonMap;
    const b2 = { paragraph: { elements: [{ textRun: { content: "two" } }], bullet: { listId: "l1", nestingLevel: 0 } } } as JsonMap;
    expect(blockToMarkdown(b1, lists, state)).toBe("1. one");
    expect(blockToMarkdown(b2, lists, state)).toBe("2. two");
  });
  it("nested bullet indent", () => {
    const lists = { l1: { listProperties: { nestingLevels: [{ glyphType: "BULLET" }, { glyphType: "BULLET" }] } } } as JsonMap;
    const block = { paragraph: { elements: [{ textRun: { content: "sub" } }], bullet: { listId: "l1", nestingLevel: 1 } } } as JsonMap;
    expect(blockToMarkdown(block, lists)).toBe("  - sub");
  });
  it("table block", () => {
    const block = { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "x" } }] } }] }] }] } } as JsonMap;
    expect(blockToMarkdown(block, undefined)).toBe("| x |\n| --- |");
  });
  it("empty block returns empty", () => {
    expect(blockToMarkdown({}, undefined)).toBe("");
  });
  it("resets deeper counter when returning to shallower level", () => {
    const lists = { l1: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }, { glyphType: "DECIMAL" }] } } } as JsonMap;
    const state = new Map<string, number>();
    const top = (n: string) => ({ paragraph: { elements: [{ textRun: { content: n } }], bullet: { listId: "l1", nestingLevel: 0 } } }) as JsonMap;
    const sub = (n: string) => ({ paragraph: { elements: [{ textRun: { content: n } }], bullet: { listId: "l1", nestingLevel: 1 } } }) as JsonMap;
    expect(blockToMarkdown(top("1"), lists, state)).toBe("1. 1");
    expect(blockToMarkdown(sub("a"), lists, state)).toBe("  1. a");
    expect(blockToMarkdown(top("2"), lists, state)).toBe("2. 2");
    // after going back to top, sub counter should be reset
    state.delete("l1:1");
    expect(blockToMarkdown(sub("a"), lists, state)).toBe("  1. a");
  });
});

describe("toMarkdownFromDocument", () => {
  it("empty when no body", () => {
    expect(toMarkdownFromDocument({})).toBe("");
  });
  it("renders full doc with separator", () => {
    const doc = {
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: "Title" } }] } },
          { paragraph: { elements: [{ textRun: { content: "para" } }] } },
        ],
      },
    } as JsonMap;
    expect(toMarkdownFromDocument(doc)).toBe("Title\n\npara\n");
  });
  it("collapses excessive blank lines", () => {
    const doc = {
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: "a" } }] } },
          { paragraph: {} },
          { paragraph: {} },
          { paragraph: { elements: [{ textRun: { content: "b" } }] } },
        ],
      },
    } as JsonMap;
    expect(toMarkdownFromDocument(doc)).toBe("a\n\nb\n");
  });
});
