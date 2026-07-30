/**
 * Pure helpers. No IO, no side effects, no global state.
 *
 * All Google API response shaping, markdown rendering, path/filename
 * normalization, JSON parsing, and OAuth URL building lives here so it can be
 * unit tested directly.
 */

import { resolve } from "node:path";

export type JsonMap = Record<string, unknown>;

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expiry_date?: number;
};

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokens: OAuthTokens;
};

export type DocExportFormat = "pdf" | "docx" | "txt" | "md" | "rtf" | "odt" | "html_zip";

export const DOC_EXPORT_MAP: Record<Exclude<DocExportFormat, "md">, { mime: string; ext: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  txt: { mime: "text/plain", ext: "txt" },
  rtf: { mime: "application/rtf", ext: "rtf" },
  odt: { mime: "application/vnd.oasis.opendocument.text", ext: "odt" },
  html_zip: { mime: "application/zip", ext: "zip" },
};

export function parseJson(text: string): JsonMap {
  try {
    return JSON.parse(text) as JsonMap;
  } catch {
    return {};
  }
}

export function isExpired(tokens: OAuthTokens) {
  if (!tokens.expiry_date) return false;
  return Date.now() >= tokens.expiry_date - 60_000;
}

export function resolveGoogleApiUrl(path: string) {
  if (path.startsWith("/v1/documents")) return new URL(`https://docs.googleapis.com${path}`);
  if (path.startsWith("/v1/presentations")) return new URL(`https://slides.googleapis.com${path}`);
  if (path.startsWith("/v4/spreadsheets")) return new URL(`https://sheets.googleapis.com${path}`);
  return new URL(`https://www.googleapis.com${path}`);
}

export function safeFilename(input: string) {
  return input
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";
}

export function normalizeOutputPath(cwd: string, outputPath: string | undefined, fallbackName: string) {
  const candidate = outputPath?.trim() ? outputPath.trim() : fallbackName;
  return resolve(cwd, candidate.replace(/^@/, ""));
}

export function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\u000b/g, "\n");
}

export function escapeMdInline(text: string) {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

export function escapeMdTableCell(text: string) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function applyInlineStyle(text: string, style: JsonMap | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  const left = text.slice(0, text.indexOf(trimmed));
  const right = text.slice(text.indexOf(trimmed) + trimmed.length);
  let core = escapeMdInline(trimmed || text);

  if (!trimmed) return escapeMdInline(text);

  const link = style?.link as JsonMap | undefined;
  const url = typeof link?.url === "string" ? link.url : undefined;

  const bold = style?.bold === true;
  const italic = style?.italic === true;
  const strike = style?.strikethrough === true;

  if (bold) core = `**${core}**`;
  if (italic) core = `*${core}*`;
  if (strike) core = `~~${core}~~`;
  if (url) core = `[${core}](${url})`;

  return `${left}${core}${right}`;
}

export function paragraphTextFromElements(elements: JsonMap[] | undefined): string {
  if (!Array.isArray(elements)) return "";

  const chunks: string[] = [];
  for (const element of elements) {
    const run = element.textRun as JsonMap | undefined;
    const content = typeof run?.content === "string" ? run.content : "";
    if (!content) continue;
    const styled = applyInlineStyle(normalizeText(content), run?.textStyle as JsonMap | undefined);
    chunks.push(styled);
  }

  return chunks.join("").replace(/\n+$/g, "").trim();
}

export function isOrderedGlyph(glyphType: string | undefined) {
  if (!glyphType) return false;
  return ["DECIMAL", "ALPHA", "ROMAN"].some((token) => glyphType.includes(token));
}

export function getHeadingPrefix(namedStyleType: string | undefined): string {
  if (!namedStyleType) return "";
  if (namedStyleType === "TITLE") return "#";
  if (namedStyleType === "SUBTITLE") return "##";
  const match = namedStyleType.match(/^HEADING_(\d)$/);
  if (!match) return "";
  const level = Number(match[1]);
  if (!Number.isFinite(level) || level < 1 || level > 6) return "";
  return "#".repeat(level);
}

export function tableToMarkdown(table: JsonMap, lists: JsonMap | undefined) {
  const rows = table.tableRows as JsonMap[] | undefined;
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const renderedRows = rows.map((row) => {
    const cells = row.tableCells as JsonMap[] | undefined;
    if (!Array.isArray(cells)) return [] as string[];

    return cells.map((cell) => {
      const content = cell.content as JsonMap[] | undefined;
      if (!Array.isArray(content)) return "";
      const chunks = content
        .map((block) => blockToMarkdown(block, lists))
        .join("\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      return escapeMdTableCell(chunks);
    });
  });

  if (renderedRows.length === 0) return "";
  const colCount = Math.max(...renderedRows.map((row) => row.length), 1);

  const normalizeRow = (row: string[]) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };

  const header = normalizeRow(renderedRows[0]);
  const divider = `| ${new Array(colCount).fill("---").join(" | ")} |`;
  const body = renderedRows.slice(1).map(normalizeRow);
  return [header, divider, ...body].join("\n");
}

export function blockToMarkdown(block: JsonMap, lists: JsonMap | undefined, listState?: Map<string, number>): string {
  const paragraph = block.paragraph as JsonMap | undefined;
  if (paragraph) {
    const elements = paragraph.elements as JsonMap[] | undefined;
    const text = paragraphTextFromElements(elements);

    const style = paragraph.paragraphStyle as JsonMap | undefined;
    const namedStyleType = typeof style?.namedStyleType === "string" ? style.namedStyleType : undefined;
    const heading = getHeadingPrefix(namedStyleType);
    if (heading && text) return `${heading} ${text}`;

    const bullet = paragraph.bullet as JsonMap | undefined;
    if (bullet) {
      const listId = typeof bullet.listId === "string" ? bullet.listId : "default";
      const nestingLevel = typeof bullet.nestingLevel === "number" ? bullet.nestingLevel : 0;
      const listInfo = (lists?.[listId] as JsonMap | undefined)?.listProperties as JsonMap | undefined;
      const levels = listInfo?.nestingLevels as JsonMap[] | undefined;
      const glyphType = typeof levels?.[nestingLevel]?.glyphType === "string" ? (levels[nestingLevel].glyphType as string) : undefined;
      const ordered = isOrderedGlyph(glyphType);

      const state = listState ?? new Map<string, number>();
      const key = `${listId}:${nestingLevel}`;
      const count = (state.get(key) ?? 0) + 1;
      state.set(key, count);

      for (const existingKey of state.keys()) {
        if (!existingKey.startsWith(`${listId}:`)) continue;
        const level = Number(existingKey.split(":")[1]);
        if (Number.isFinite(level) && level > nestingLevel) state.delete(existingKey);
      }

      const indent = "  ".repeat(Math.max(0, nestingLevel));
      const marker = ordered ? `${count}.` : "-";
      return `${indent}${marker} ${text}`.trimEnd();
    }

    return text;
  }

  const table = block.table as JsonMap | undefined;
  if (table) return tableToMarkdown(table, lists);

  return "";
}

export function toMarkdownFromDocument(document: JsonMap) {
  const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
  if (!Array.isArray(body) || body.length === 0) return "";

  const lists = document.lists as JsonMap | undefined;
  const listState = new Map<string, number>();
  const chunks: string[] = [];

  for (const block of body) {
    const rendered = blockToMarkdown(block, lists, listState).trim();
    if (!rendered) continue;
    chunks.push(rendered);
  }

  const markdown = chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return markdown ? `${markdown}\n` : "";
}

export function sheetValuesToText(values: unknown[][]) {
  if (!Array.isArray(values) || values.length === 0) return "(no data)";

  return values
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join("\t") : ""))
    .join("\n");
}

export function getDocEndIndex(document: JsonMap): number {
  const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
  if (!Array.isArray(body) || body.length === 0) return 1;

  const last = body[body.length - 1];
  const endIndex = typeof last.endIndex === "number" ? last.endIndex : 1;
  return Math.max(1, endIndex);
}

export function extractDocText(document: JsonMap): string {
  const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
  if (!Array.isArray(body)) return "";

  const chunks: string[] = [];

  for (const block of body) {
    const paragraph = block.paragraph as JsonMap | undefined;
    const elements = paragraph?.elements as JsonMap[] | undefined;
    if (!Array.isArray(elements)) continue;

    for (const element of elements) {
      const run = element.textRun as JsonMap | undefined;
      const content = run?.content;
      if (typeof content === "string") chunks.push(content);
    }
  }

  return chunks.join("").trim();
}

export function getDocInsertIndex(document: JsonMap): number {
  const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
  if (!Array.isArray(body) || body.length === 0) return 1;

  const last = body[body.length - 1];
  const endIndex = typeof last.endIndex === "number" ? last.endIndex : 1;
  return Math.max(1, endIndex - 1);
}

export function extractSlidesText(presentation: JsonMap) {
  const slides = presentation.slides as JsonMap[] | undefined;
  if (!Array.isArray(slides)) return [] as Array<{ slideId: string; index: number; text: string }>;

  return slides.map((slide, index) => {
    const pageElements = slide.pageElements as JsonMap[] | undefined;
    const chunks: string[] = [];

    if (Array.isArray(pageElements)) {
      for (const pageElement of pageElements) {
        const shape = pageElement.shape as JsonMap | undefined;
        const text = shape?.text as JsonMap | undefined;
        const elements = text?.textElements as JsonMap[] | undefined;

        if (!Array.isArray(elements)) continue;

        for (const element of elements) {
          const run = element.textRun as JsonMap | undefined;
          const content = run?.content;
          if (typeof content === "string") chunks.push(content);
        }
      }
    }

    return {
      slideId: typeof slide.objectId === "string" ? slide.objectId : `slide-${index + 1}`,
      index: index + 1,
      text: chunks.join("").trim(),
    };
  });
}

export function authUrl(config: { clientId: string; redirectUri: string; state: string }, scope: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", config.state);
  return url.toString();
}
