import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getConfigDir: () => "/fake/config",
  getConfigPath: () => "/fake/config/oauth.json",
  fs: fsMocks,
  homedir: () => "/fake/home",
}));

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
  redirectUri: "http://127.0.0.1/cb",
  tokens: { access_token: "A", refresh_token: "R", expiry_date: Date.now() + 3_600_000 },
};

type Tool = { name: string; execute: (...args: never[]) => Promise<unknown> };

function getTool(name: string): Tool {
  const tools: Tool[] = [];
  googleWorkspaceExtension({
    registerTool: (tool: Tool) => tools.push(tool),
    registerCommand: () => undefined,
    on: () => undefined,
    exec: async () => undefined,
  } as never);
  return tools.find((tool) => tool.name === name)!;
}

async function run(name: string, params: Record<string, unknown> = {}) {
  return (getTool(name).execute as (id: string, params: unknown, signal: unknown, update: unknown, ctx: unknown) => Promise<unknown>)(
    "id", params, undefined, undefined, { cwd: "/tmp/cwd" },
  );
}

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
    headers: new Headers({ "content-type": "application/json" }),
  } as Response;
}

beforeEach(() => {
  fsMocks.readFile.mockReset().mockResolvedValue(JSON.stringify(config));
  fsMocks.writeFile.mockClear();
  fsMocks.mkdir.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("tool fallback and optional argument behavior", () => {
  it("reports configured status without expiry or refresh token", async () => {
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ ...config, tokens: { access_token: "A" } }));
    const out = await run("google_workspace_status") as { details: { refreshToken: boolean; expiresAt: null; expired: null }; content: { text: string }[] };
    expect(out.details).toMatchObject({ refreshToken: false, expiresAt: null, expired: null });
    expect(out.content[0].text).toContain("unknown");
  });

  it("formats malformed Drive list entries with safe defaults", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ files: [{}], nextPageToken: "NEXT" }));
    const out = await run("google_drive_list", { query: "starred=true", pageSize: 100 }) as { content: { text: string }[]; details: { nextPageToken: string } };
    expect(out.content[0].text).toContain("(no name)");
    expect(out.content[0].text).toContain("unknown");
    expect(out.details.nextPageToken).toBe("NEXT");
  });

  it("downloads with metadata defaults and explicit output path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce({ ...ok("data"), arrayBuffer: async () => new TextEncoder().encode("data").buffer });
    const out = await run("google_drive_download", { fileId: "ID", outputPath: "custom.bin" }) as { details: { name: string; mimeType: string; outputPath: string } };
    expect(out.details).toMatchObject({ name: "ID", mimeType: "application/octet-stream", outputPath: "/tmp/cwd/custom.bin" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uploads with default name and MIME type and tolerates missing response fields", async () => {
    fsMocks.readFile.mockReset()
      .mockResolvedValueOnce(Buffer.from("bytes"))
      .mockResolvedValueOnce(JSON.stringify(config));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 7, webViewLink: 8 }));
    const out = await run("google_drive_upload", { localPath: "@nested/file.bin" }) as { details: { fileId: string; name: string; mimeType: string; webViewLink: string } };
    expect(out.details).toMatchObject({ fileId: "", name: "file.bin", mimeType: "application/octet-stream", webViewLink: "" });
  });

  it("creates folder with parent and tolerates missing response fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 3, webViewLink: 4 }));
    const out = await run("google_drive_create_folder", { name: "Folder", parentId: "P" }) as { details: { folderId: string; webViewLink: string } };
    expect(out.details).toMatchObject({ folderId: "", webViewLink: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).parents).toEqual(["P"]);
  });

  it("creates named first sheet without header or URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ spreadsheetId: "S" }));
    const out = await run("google_sheets_create", { title: "Book", sheetTitle: "Data", headerRow: [] }) as { details: { spreadsheetUrl: string } };
    expect(out.details.spreadsheetUrl).toBe("");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).sheets[0].properties.title).toBe("Data");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses requested read range/rendering and handles missing values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ values: "bad" }));
    const out = await run("google_sheets_read", { spreadsheetId: "S", range: " Data!A1 ", valueRenderOption: "FORMULA" }) as { details: { range: string; rowCount: number } };
    expect(out.details).toMatchObject({ range: "Data!A1", rowCount: 0 });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("valueRenderOption")).toBe("FORMULA");
  });

  it("formats malformed and hidden tabs then handles empty spreadsheet metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ sheets: [{ properties: { hidden: true } }, {}] }));
    const out = await run("google_sheets_list_tabs", { spreadsheetId: "S" }) as { content: { text: string }[]; details: { title: string; spreadsheetUrl: string } };
    expect(out.details).toMatchObject({ title: "S", spreadsheetUrl: "" });
    expect(out.content[0].text).toContain("(unnamed) [hidden]");
    expect(out.content[0].text).toContain("? rows");
  });

  it("uses update response fallbacks and RAW input option", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ updatedRange: 4, updatedRows: "one" }));
    const out = await run("google_sheets_update_values", { spreadsheetId: "S", range: "A1", values: [[]], valueInputOption: "RAW" }) as { details: { updatedRange: string; updatedRows: number } };
    expect(out.details).toMatchObject({ updatedRange: "A1", updatedRows: 0 });
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get("valueInputOption")).toBe("RAW");
  });

  it("handles batch update without replies or optional response ranges", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ replies: "bad" }));
    const out = await run("google_sheets_batch_update", { spreadsheetId: "S", requests: [], responseRanges: [] }) as { details: { replies: unknown[] } };
    expect(out.details.replies).toEqual([]);
  });

  it("builds scatter chart without header, labels, title, or reply", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ replies: "bad" }));
    const out = await run("google_sheets_add_chart", {
      spreadsheetId: "S",
      sheetId: 1,
      chartType: "scatter",
      headerRow: false,
      dataRange: { startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 3 },
      anchorCell: { rowIndex: 2, columnIndex: 4 },
      stacked: true,
    }) as { details: { chartId?: number } };
    expect(out.details.chartId).toBeUndefined();
    const chart = JSON.parse(fetchMock.mock.calls[0][1]!.body as string).requests[0].addChart.chart;
    expect(chart.spec.title).toBe("");
    expect(chart.spec.basicChart.headerCount).toBe(0);
    expect(chart.spec.basicChart.stackedType).toBeUndefined();
    expect(chart.spec.basicChart.series.map((series: { targetAxis: string }) => series.targetAxis)).toEqual(["LEFT_AXIS", "BOTTOM_AXIS"]);
  });
});
