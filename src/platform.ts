/**
 * Platform seam for testability.
 *
 * Centralizes non-deterministic / side-effecting dependencies (fs, homedir,
 * config path) so tests can mock this single module instead of patching
 * built-ins. Config path computed lazily, not at module load.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

export const EXTENSION_NAME = "google-workspace";

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";

export const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export function getConfigDir(): string {
  return join(homedir(), ".pi", "agent", "google-workspace");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "oauth.json");
}

export const fs = {
  mkdir,
  readFile,
  rm,
  writeFile,
};

export { homedir };
