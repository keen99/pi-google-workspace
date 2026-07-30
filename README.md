# pi Google Workspace Extension

Google Workspace extension for [pi](https://github.com/badlogic/pi-mono):
- Google Drive (list, upload, download, create folder)
- Google Docs (read, create, append, replace, export)
- Google Sheets (create, read, update)
- Google Slides (read, replace text)
- OAuth setup helpers (`/gws-setup`, `/gws-logout`, `google_workspace_status`)

## Install

### npm
```bash
pi install npm:pi-google-workspace
```

Then run:
```bash
/gws-setup
```

## OAuth and Google Cloud Console Setup (Detailed)

This extension uses OAuth 2.0 and requires Google Workspace APIs to be enabled in your Google Cloud project.

### 1) Create or select a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector in the top bar.
3. Create a new project (or select an existing one).
4. Make sure billing/org policies allow API access for this project.

### 2) Enable required APIs

Go to **APIs & Services → Library**, then enable all of the following:

- **Google Drive API**
- **Google Docs API**
- **Google Slides API**
- **Google Sheets API**

Tip: You can verify from **APIs & Services → Enabled APIs & services**.

### 3) Configure OAuth consent screen

Go to **APIs & Services → OAuth consent screen**:

1. Choose **External** (personal Gmail) or **Internal** (Google Workspace org only).
2. Fill required app info:
   - App name
   - User support email
   - Developer contact email
3. Add scopes (minimum required by this extension):
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/presentations`
   - `https://www.googleapis.com/auth/spreadsheets`
4. If app is in **Testing**, add your Google account under **Test users**.
5. Save and continue.

> Note: Sensitive/restricted scopes may require verification for production/public distribution. For personal use in testing mode, test users are usually enough.

### 4) Create OAuth client credentials

Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:

- Recommended client type: **Desktop app**
- Also supported: **Web application**

If you choose **Web application**, add this redirect URI exactly:

- `http://127.0.0.1:53682/oauth2callback`

Then copy:
- **Client ID**
- **Client Secret**

### 5) Connect in pi

Run inside pi:

```bash
/reload
/gws-setup
```

Then:
1. Paste Client ID
2. Paste Client Secret
3. Confirm Redirect URI (default is recommended)
4. Complete Google sign-in + consent in browser

### 6) Token storage and refresh behavior

Credentials are stored locally at:
- `~/.pi/agent/google-workspace/oauth.json`

The extension stores `access_token` and `refresh_token` for automatic refresh.
If `refresh_token` is missing (or scopes changed), run `/gws-setup` again and re-consent.

### 7) Common setup issues

- **"redirect_uri_mismatch"**
  - The redirect URI in Google Cloud does not exactly match the one used in `/gws-setup`.
- **"access_denied" or app not available**
  - Your account is not added as a test user (when app is in Testing).
- **API not enabled / 403 errors**
  - One or more required APIs were not enabled in the selected project.
- **No refresh token returned**
  - Re-run `/gws-setup` and grant consent again.

## Available Tools

### Drive
- `google_drive_list`
- `google_drive_download`
- `google_drive_upload`
- `google_drive_create_folder`

### Docs
- `google_docs_read`
- `google_docs_create`
- `google_docs_append_text`
- `google_docs_replace_all_text`
- `google_docs_download`

### Sheets
- `google_sheets_create`
- `google_sheets_read`
- `google_sheets_update_values`
- `google_sheets_list_tabs` (keen99 fork)
- `google_sheets_batch_update` (keen99 fork — formats, validations, merges, sheet ops, find/replace, charts, protected ranges, named ranges, conditional formatting)
- `google_sheets_add_chart` (keen99 fork — column/bar/line/area/pie/scatter chart from data range)
- `google_sheets_list_objects` (keen99 fork — list charts/images/pivot tables; returns objectIds for deletion)
- `google_sheets_read_format` (keen99 fork — read cell formatting: text color, fill, font, bold, borders, number format)

### Slides
- `google_slides_read`
- `google_slides_replace_text`

### Status
- `google_workspace_status`

The package gallery reads npm packages that include the `pi-package` keyword.

## Development

- Main extension file: `index.ts`
- Reload in pi: `/reload`
- Re-run setup after scope changes: `/gws-setup`

## Testing

Full TDD test suite via [vitest](https://vitest.dev/). Three layers:

1. **Pure helpers** (`src/pure.ts`) — pure fns, no mocks. Markdown rendering, JSON parse, path normalize, OAuth URL, doc/slide/sheet extraction.
2. **IO layer** (`index.ts`) — config read/write, token refresh, `googleRequest`/`googleBinaryRequest`/`googleDriveMultipartUpload`, `exchangeCodeForToken`. Mocked via `src/platform.ts` seam + `globalThis.fetch` spies.
3. **Factory + tools** (`index.ts`) — fake `ExtensionAPI` records registrations; each tool handler exercised with mocked fetch + fs.

### Layout

```
index.ts          # extension entrypoint (IO + factory)
src/pure.ts       # pure helpers (exported, tested directly)
src/platform.ts   # platform seam: fs/homedir/config-path (mockable)
test/*.test.ts    # vitest specs
vitest.config.ts  # vitest + v8 coverage config
tsconfig.json     # project type-check
```

### Commands

```bash
npm test            # vitest run
npm run test:watch  # watch mode
npm run test:coverage  # run + v8 coverage report
npm run typecheck   # tsc --noEmit
npm run check       # type-check + tests (same as pre-commit hook)
```

### Architecture (TDD)

- Pure helpers split to `src/pure.ts` so unit tests need no mocks — fastest, highest-value coverage.
- IO fns use `src/platform.ts` seam (`fs`, `getConfigPath()`) instead of hardcoding `homedir()` at module load. Tests `vi.mock("../src/platform.js")`.
- Default-exported factory registered tools/commands captured by fake `pi`, then handlers called directly.
- Coverage thresholds enforced per source file in `vitest.config.ts`: statements 75%, branches 60%, functions 80%, lines 75%.

### Coverage

Current: ~82% statements, ~69% branches, ~90% functions, ~84% lines. Uncovered = mostly UI-prompt branches in `gws-setup`/`gws-logout` commands (interactive, hard to test) + `waitForAuthCode` HTTP server paths.

Coverage output includes every `src/**/*.ts` file and `index.ts`. Console report shows full uncovered line ranges. Detailed HTML report lives at `coverage/index.html`; machine-readable summary lives at `coverage/coverage-summary.json`. Coverage reports are also generated when tests fail.

## Security Notes

- Do not commit OAuth tokens (`oauth.json`).
- Use least-privilege OAuth scopes when possible.
- Revoke credentials from Google account security settings if compromised.
