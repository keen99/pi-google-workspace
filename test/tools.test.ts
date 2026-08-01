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

// index.ts also imports mkdir/readFile/writeFile from node:fs/promises directly
// for download/upload paths. Mock them too so no real disk touch.
vi.mock("node:fs/promises", () => ({
  mkdir: fsMocks.mkdir,
  readFile: fsMocks.readFile,
  rm: fsMocks.rm,
  writeFile: fsMocks.writeFile,
}));

import googleWorkspaceExtension from "../index.js";

const config = {
  clientId: "CID",
  clientSecret: "SEC",
  redirectUri: "http://x",
  tokens: { access_token: "A", refresh_token: "R", expiry_date: Date.now() + 3_600_000 },
};

type Tool = { name: string; execute: (...a: never[]) => Promise<unknown> };

function getTools(): Tool[] {
  const tools: Tool[] = [];
  const pi = {
    registerTool: (t: Tool) => tools.push(t),
    registerCommand: () => undefined,
    on: () => undefined,
    exec: async () => undefined,
  } as never;
  googleWorkspaceExtension(pi);
  return tools;
}

function fetchOk(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return {
    ok: true,
    status: 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => {
      const s = typeof body === "string" ? body : JSON.stringify(body);
      return new TextEncoder().encode(s).buffer;
    },
    headers: new Headers(headers),
  } as unknown as Response;
}

beforeEach(() => {
  fsMocks.readFile.mockResolvedValue(JSON.stringify(config));
  fsMocks.writeFile.mockClear();
  fsMocks.mkdir.mockClear();
});
afterEach(() => vi.restoreAllMocks());

async function runTool(name: string, params: Record<string, unknown> = {}) {
  const tools = getTools();
  const t = tools.find((x) => x.name === name)!;
  // execute(toolCallId, params, signal, onUpdate, ctx)
  const ctx = { cwd: "/tmp/test-cwd" } as never;
  return (t.execute as (id: string, p: unknown, s: unknown, u: unknown, c: unknown) => Promise<unknown>)(
    "callId", params, undefined, undefined, ctx,
  );
}

describe("google_drive_list", () => {
  it("lists + formats files", async () => {
    const f = vi.fn().mockResolvedValue(fetchOk({ files: [{ id: "1", name: "A", mimeType: "text/plain", modifiedTime: "t" }] }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_drive_list", { pageSize: 5 })) as { content: { text: string }[]; details: { count: number } };
    expect(out.details.count).toBe(1);
    expect(out.content[0].text).toContain("A");
    expect(f.mock.calls[0][1].method).toBe("GET");
  });
  it("empty files -> No files found", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ files: [] })));
    const out = (await runTool("google_drive_list")) as { content: { text: string }[] };
    expect(out.content[0].text).toBe("No files found.");
  });
});

describe("google_drive_create_folder", () => {
  it("posts folder metadata + returns id", async () => {
    const f = vi.fn().mockResolvedValue(fetchOk({ id: "FID", webViewLink: "u" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_drive_create_folder", { name: "New" })) as { details: { folderId: string } };
    expect(out.details.folderId).toBe("FID");
    expect(f.mock.calls[0][1].method).toBe("POST");
  });
});

describe("google_sheets_create", () => {
  it("creates + writes header row", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ spreadsheetId: "S1", spreadsheetUrl: "u", sheets: [{ properties: { title: "Sheet1" } }] }))
      .mockResolvedValueOnce(fetchOk({ updatedRange: "Sheet1!A1", updatedRows: 1 }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_sheets_create", { title: "T", headerRow: ["a", "b"] })) as { details: { spreadsheetId: string } };
    expect(out.details.spreadsheetId).toBe("S1");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("throws when spreadsheetId missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({})));
    await expect(runTool("google_sheets_create", { title: "T" })).rejects.toThrow(/spreadsheetId/);
  });
});

describe("google_sheets_read", () => {
  it("reads values + tab format", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ values: [["a", "b"]] })));
    const out = (await runTool("google_sheets_read", { spreadsheetId: "S" })) as { content: { text: string }[] };
    expect(out.content[0].text).toBe("a\tb");
  });
});

describe("google_sheets_list_tabs", () => {
  it("lists tabs with grid info", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      properties: { title: "Book" },
      spreadsheetUrl: "u",
      sheets: [{ properties: { sheetId: 1, title: "S1", index: 0, gridProperties: { rowCount: 10, columnCount: 3 } } }],
    })));
    const out = (await runTool("google_sheets_list_tabs", { spreadsheetId: "S" })) as { details: { tabs: { title: string }[] } };
    expect(out.details.tabs[0].title).toBe("S1");
  });
});

describe("google_sheets_update_values", () => {
  it("PUTs values + returns range", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ updatedRange: "Sheet1!A2", updatedRows: 1 })));
    const out = (await runTool("google_sheets_update_values", { spreadsheetId: "S", range: "Sheet1!A2", values: [["x"]] })) as { details: { updatedRows: number } };
    expect(out.details.updatedRows).toBe(1);
  });
});

describe("google_sheets_batch_update", () => {
  it("posts requests + parses replies", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ replies: [{ addSheet: { properties: { title: "New", sheetId: 9 } } }] })));
    const out = (await runTool("google_sheets_batch_update", { spreadsheetId: "S", requests: [{ addSheet: {} }] })) as { details: { requestCount: number } };
    expect(out.details.requestCount).toBe(1);
  });
  it("findReplace reply parsed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ replies: [{ findReplace: { valuesChanged: 3 } }] })));
    const out = (await runTool("google_sheets_batch_update", { spreadsheetId: "S", requests: [{}] })) as { content: { text: string }[] };
    expect(out.content[0].text).toContain("3 value(s) changed");
  });
  it("sends optional response controls as query parameters", async () => {
    const f = vi.fn().mockResolvedValue(fetchOk({ replies: [] }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await runTool("google_sheets_batch_update", {
      spreadsheetId: "S",
      requests: [],
      responseIncludeGridData: true,
      responseRanges: ["Sheet1!A1:B2", "Other!C3"],
    });
    const url = f.mock.calls[0][0] as URL;
    expect(url.searchParams.get("responseIncludeGridData")).toBe("true");
    expect(url.searchParams.get("ranges")).toBe("Sheet1!A1:B2,Other!C3");
  });
});

describe("google_sheets_add_chart", () => {
  it("throws when no value column", async () => {
    await expect(runTool("google_sheets_add_chart", {
      spreadsheetId: "S", sheetId: 1, chartType: "COLUMN",
      dataRange: { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
      anchorCell: { rowIndex: 0, columnIndex: 5 },
    })).rejects.toThrow(/at least 1/);
  });
  it("builds column chart request + returns chartId", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ replies: [{ addChart: { chartId: 7 } }] })));
    const out = (await runTool("google_sheets_add_chart", {
      spreadsheetId: "S", sheetId: 1, chartType: "COLUMN", title: "T",
      dataRange: { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 },
      anchorCell: { rowIndex: 0, columnIndex: 5 }, stacked: true,
    })) as { details: { chartId: number; chartType: string } };
    expect(out.details.chartId).toBe(7);
    expect(out.details.chartType).toBe("COLUMN");
  });
  it("pie chart deletes axis", async () => {
    const f = vi.fn().mockResolvedValue(fetchOk({ replies: [{ addChart: { chartId: 1 } }] }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    await runTool("google_sheets_add_chart", {
      spreadsheetId: "S", sheetId: 1, chartType: "PIE",
      dataRange: { startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 },
      anchorCell: { rowIndex: 0, columnIndex: 5 },
    } as never);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.requests[0].addChart.chart.spec.basicChart.axis).toBeUndefined();
  });
});

describe("google_sheets_list_objects", () => {
  it("lists charts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      sheets: [{ properties: { sheetId: 1, title: "S1" }, charts: [{ chartId: 5, spec: { title: "C", basicChart: { chartType: "COLUMN", series: [{}] } }, position: { overlayPosition: { anchorCell: { rowIndex: 0, columnIndex: 5 } } } }] }],
    })));
    const out = (await runTool("google_sheets_list_objects", { spreadsheetId: "S", sheetId: 1 })) as { details: { count: number; objects: { title: string }[] } };
    expect(out.details.count).toBe(1);
    expect(out.details.objects[0].title).toBe("C");
  });
});

describe("google_sheets_read_format", () => {
  it("reads cell formats + color conversion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData: [{ values: [{ formattedValue: "x", userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 0, blue: 0 } } } }] }] }] }],
    })));
    const out = (await runTool("google_sheets_read_format", { spreadsheetId: "S", range: "Sheet1!A1" })) as { details: { cellCount: number; cells: { textColor: string; textBold: boolean }[][] } };
    expect(out.details.cellCount).toBe(1);
    expect(out.details.cells[0][0].textColor).toBe("#ff0000");
    expect(out.details.cells[0][0].textBold).toBe(true);
  });
  it("includeValues false omits formattedValue", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      sheets: [{ data: [{ rowData: [{ values: [{ formattedValue: "x", userEnteredValue: "x" }] }] }] }],
    })));
    const out = (await runTool("google_sheets_read_format", { spreadsheetId: "S", range: "A1", includeValues: false })) as { details: { cells: { formattedValue?: unknown }[][] } };
    expect(out.details.cells[0][0].formattedValue).toBeUndefined();
  });
});

describe("google_docs_read", () => {
  it("extracts doc text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      title: "Doc",
      body: { content: [{ paragraph: { elements: [{ textRun: { content: "hello" } }] } }] },
    })));
    const out = (await runTool("google_docs_read", { documentId: "D" })) as { content: { text: string }[]; details: { textLength: number } };
    expect(out.details.textLength).toBe(5);
    expect(out.content[0].text).toContain("hello");
  });
});

describe("google_docs_create", () => {
  it("creates + inserts text", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ documentId: "D1" }))
      .mockResolvedValueOnce(fetchOk({}));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_docs_create", { title: "T", initialText: "hi" })) as { details: { documentId: string } };
    expect(out.details.documentId).toBe("D1");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("throws when documentId missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({})));
    await expect(runTool("google_docs_create", { title: "T" })).rejects.toThrow(/documentId/);
  });
});

describe("google_docs_replace_all_text", () => {
  it("deletes old range + inserts new", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ body: { content: [{ endIndex: 10 }] } }))
      .mockResolvedValueOnce(fetchOk({}));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_docs_replace_all_text", { documentId: "D", text: "new" })) as { details: { endIndex: number } };
    expect(out.details.endIndex).toBe(10);
    const reqBody = JSON.parse(f.mock.calls[1][1].body);
    expect(reqBody.requests).toHaveLength(2);
    expect(reqBody.requests[0].deleteContentRange).toBeDefined();
    expect(reqBody.requests[1].insertText).toBeDefined();
  });
});

describe("google_docs_append_text", () => {
  it("inserts at end index", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ body: { content: [{ endIndex: 10 }] } }))
      .mockResolvedValueOnce(fetchOk({ replies: [] }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_docs_append_text", { documentId: "D", text: "x" })) as { details: { index: number } };
    expect(out.details.index).toBe(9);
  });
});

describe("google_docs_download", () => {
  it("md format renders markdown without binary fetch", async () => {
    const f = vi.fn().mockResolvedValue(fetchOk({
      title: "Doc",
      body: { content: [{ paragraph: { elements: [{ textRun: { content: "hi" } }] } }] },
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_docs_download", { documentId: "D", format: "md" })) as { details: { format: string; outputPath: string } };
    expect(out.details.format).toBe("md");
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("pdf format exports binary", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ title: "Doc" }))
      .mockResolvedValueOnce(fetchOk("%PDF-binary"));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_docs_download", { documentId: "D", format: "pdf" })) as { details: { format: string } };
    expect(out.details.format).toBe("pdf");
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
  });
  it("throws on unsupported format", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ title: "D" })));
    await expect(runTool("google_docs_download", { documentId: "D", format: "doc" })).rejects.toThrow(/Unsupported format/);
  });
});

describe("google_slides_read", () => {
  it("extracts slide text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({
      title: "Pres",
      slides: [{ objectId: "s1", pageElements: [{ shape: { text: { textElements: [{ textRun: { content: "title" } }] } } }] }],
    })));
    const out = (await runTool("google_slides_read", { presentationId: "P" })) as { details: { slideCount: number } };
    expect(out.details.slideCount).toBe(1);
  });
});

describe("google_slides_replace_text", () => {
  it("returns occurrences changed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(fetchOk({ replies: [{ replaceAllText: { occurrencesChanged: 4 } }] })));
    const out = (await runTool("google_slides_replace_text", { presentationId: "P", findText: "a", replaceText: "b" })) as { details: { occurrencesChanged: number } };
    expect(out.details.occurrencesChanged).toBe(4);
  });
});

describe("google_drive_upload", () => {
  it("reads exact local file bytes + multipart uploads", async () => {
    fsMocks.readFile.mockReset()
      .mockResolvedValueOnce(Buffer.from("FILE-CONTENTS"))
      .mockResolvedValueOnce(JSON.stringify(config));
    const f = vi.fn().mockResolvedValue(fetchOk({ id: "UP", webViewLink: "u" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_drive_upload", { localPath: "f.txt", name: "remote.txt", parentId: "P", mimeType: "text/custom" })) as { details: { fileId: string } };
    expect(out.details.fileId).toBe("UP");
    expect(fsMocks.readFile).toHaveBeenNthCalledWith(1, "/tmp/test-cwd/f.txt");
    expect(f.mock.calls[0][1].method).toBe("POST");
    const body = f.mock.calls[0][1].body as Buffer;
    expect(body.toString()).toContain("FILE-CONTENTS");
    expect(body.toString()).toContain('"name":"remote.txt"');
    expect(body.toString()).toContain('"parents":["P"]');
    expect(body.toString()).toContain("Content-Type: text/custom");
  });
});

describe("google_drive_download binary", () => {
  it("downloads non-native file + writes", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(fetchOk({ id: "1", name: "file.txt", mimeType: "text/plain" }))
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => "",
        arrayBuffer: async () => new TextEncoder().encode("data").buffer,
        headers: new Headers({ "content-type": "text/plain" }),
      });
    vi.spyOn(globalThis, "fetch").mockImplementation(f);
    const out = (await runTool("google_drive_download", { fileId: "1" })) as { details: { bytesWritten: number } };
    expect(out.details.bytesWritten).toBe(4);
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
  });
});
