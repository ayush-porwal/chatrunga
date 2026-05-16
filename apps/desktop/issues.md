# Chaturanga — UI & functionality audit (`http://localhost:5173/`)

**App:** `@chaturanga/desktop` (Electron + Vite renderer)  
**Audit date:** 2026-05-14  
**Server check:** `GET http://localhost:5173/` returned **200** (no dev server start required).

## Audit methodology & blockers

- **Browser MCP:** The `cursor-ide-browser` MCP server is **not enabled** in this agent session (tool calls return “tool not found”; only `cursor-app-control`, AWS, Linear, Neon, Sentry, Tolaria tools registered). No `browser_snapshot`, console, or network capture via MCP.
- **Headless automation:** `playwright-core` + system Chrome **launch failed** (“Target page, context or browser has been closed”). `Google Chrome --headless=new --dump-dom` exited **134** with no DOM output. **No screenshot artifacts** were produced in this environment.
- **Remaining evidence:** Static review of `src/renderer` sources, `index.html`, and `curl` of the dev HTML shell (Vite injects extra inline scripts in dev).

Follow-up for another agent: rerun the same checks **in Cursor with browser MCP enabled**, or locally with Playwright/Puppeteer against `http://127.0.0.1:5173/`, and attach screenshots + `console` / `network` HAR.

---

## Critical

_No issues raised to Critical solely from static review; platform mis-usage (browser vs Electron) is documented under High._

---

## High

### H1 — Desktop-only API: plain browser session is materially degraded

- **Steps to reproduce:** Open `http://localhost:5173/` in a normal browser (not packaged Electron). Use flows that call IPC (`Import PGN`, engine setup, DB download, live analysis, etc.).
- **Expected:** Either a clear “desktop only” gate or graceful stubs so the UI does not look broken.
- **Actual:** `window.chaturanga` is injected by the **preload** in Electron; in a stock browser it is **`undefined`**. Queries often fall back to `[]` / defaults (`queries/api.ts`), while engine/analysis paths set user-visible errors (e.g. `App.tsx` analysis effect: *“Desktop engine API is unavailable in this environment.”*). File dialogs, saves, and downloads will not function.
- **Evidence:** `src/renderer/src/queries/api.ts` (`api()` / `requireApi()`); `App.tsx` analysis `useEffect` branch when `!window.chaturanga`.
- **Suggested fix:** Detect missing API once at bootstrap; show a full-width banner or dedicated “Web preview” mode with mocked data; or document that `5173` is **Electron-only** and avoid testing in a raw browser.

### H2 — Strict CSP vs Vite dev inline scripts (HMR / Fast Refresh)

- **Steps to reproduce:** Load the app in dev (`electron-vite dev` / Vite). Open DevTools → **Console** / **Issues** → CSP violations.
- **Expected:** No CSP violations; React Refresh and Vite client behave normally.
- **Actual:** `index.html` sets `script-src 'self'` only. Vite dev injects an **inline** `<script type="module">` for `/@react-refresh` (confirmed in fetched HTML). That pattern is typically **blocked** by `script-src 'self'` (no `'unsafe-inline'`, no hash/nonce). Symptom: CSP reports; **Fast Refresh may be partially or fully broken** in browser devtools.
- **Evidence:** `src/renderer/index.html` CSP meta; `curl -s http://localhost:5173/` shows Vite-injected inline module before `/@vite/client`.
- **Suggested fix:** For dev builds, relax CSP (e.g. `'unsafe-inline'` for `script-src` only under `import.meta.env.DEV`), or remove the meta CSP from the Vite HTML template and apply CSP only in the **packaged** Electron `BrowserWindow`. Use nonces if you must keep strict CSP.

---

## Medium

### M1 — Misleading `aria-label`s on top bar navigation buttons

- **Steps to reproduce:** Focus the first icon button in the top “Game controls” bar (game view).
- **Expected:** Accessible name matches action (e.g. “Home” / “Settings”).
- **Actual:** Labels are **“Back”** and **“Forward”** but actions are **`setAppView("home")`** and **`setAppView("settings")`** (`App.tsx`, ~lines 800–822). Screen reader users are misled; does not match visual intent.
- **Evidence:** `App.tsx` `aria-label="Back"` / `aria-label="Forward"`.
- **Suggested fix:** Rename to `aria-label="Home"` and `aria-label="Settings"` (and adjust `disabled` logic messaging if needed).

### M2 — `file://` engine images in an `http://` page

- **Steps to reproduce:** Configure an engine with a **local** avatar path; open renderer in a **browser** at `http://127.0.0.1:5173/`.
- **Expected:** Image loads or a safe fallback is shown.
- **Actual:** `localImageSrc` maps non-URL paths to `file://…` (`src/renderer/src/lib/local-image.ts`). Many browsers **block or restrict `file:` loads** from `http:` origins even when CSP allows `img-src file:` (mixed security context).
- **Evidence:** `local-image.ts`; usages in `BoardView.tsx`, `EngineGameControls.tsx`, `EngineSettingsDialog.tsx`.
- **Suggested fix:** In web preview/dev browser, resolve images via a custom `vite`/`app` protocol or IPC blob URLs; in Electron, keep current behavior.

### M3 — Focus tokens on `Button` may be undefined (`ring-ring`, `border-ring`)

- **Steps to reproduce:** Tab through interactive controls with keyboard; compare focus halo across app.
- **Expected:** Visible, consistent 3px (or similar) focus ring per WCAG 2.4.7.
- **Actual:** `components/ui/button.tsx` uses `focus-visible:border-ring` and `focus-visible:ring-ring/50`. The renderer `app.css` only imports Tailwind; **no `@theme` definition** for `--color-ring` (or `ring`) was found. Tailwind may fall back to a no-op or inconsistent color.
- **Evidence:** `button.tsx` line 7; `styles/app.css` content.
- **Suggested fix:** Define `--color-ring` (and matching `border-ring`) in theme CSS or replace with concrete colors (e.g. `focus-visible:ring-[#8fb66f]/50`).

### M4 — Home workflow cards: uneven layout on medium breakpoints

- **Steps to reproduce:** View Home at widths **md–lg** (Tailwind `md` range). Five cards use `md:grid-cols-2` then `xl:grid-cols-5`.
- **Expected:** Balanced grid or intentional asymmetry.
- **Actual:** Five items in **2 columns** yield **2 + 2 + 1** — last row has a **single wide card**; visual weight and hover targets feel uneven (minor polish issue).
- **Evidence:** `HomePage` in `App.tsx`, grid classes `gap-3 md:grid-cols-2 xl:grid-cols-5`.

---

## Low

### L1 — Decorative product images use `alt=""`

- **Steps to reproduce:** Inspect sidebar / collapsed menu brand icons.
- **Actual:** `<img … alt="">` for decorative icons is acceptable for AT if truly decorative; if the icon is the **only** brand signifier when the sidebar is collapsed, some teams prefer `alt="Chaturanga"` for consistency.
- **Evidence:** `App.tsx` sidebar and `CollapsedBrandMenu` images.

### L2 — Redundant `sr-only` status next to title when `appView === "game"`

- **Steps to reproduce:** Screen reader on game view.
- **Actual:** `viewTitle` already equals `statusMessage` in game mode, but an additional `<span className="sr-only">{statusMessage}</span>` duplicates the announcement.
- **Evidence:** `App.tsx` (~822–828).
- **Suggested fix:** Remove duplicate or only emit `sr-only` when `viewTitle !== statusMessage`.

### L3 — `window.confirm` for database deletion (native dialog styling)

- **Steps to reproduce:** Delete an installed database from **Databases** page.
- **Actual:** Uses `window.confirm` (`DatabasePage.tsx`), which breaks visual consistency with the custom dark UI and cannot be styled.
- **Suggested fix:** Replace with in-app `AlertDialog` pattern matching existing modals.

---

## Responsive / typography (observations, not bugs without visual proof)

- Layout relies heavily on `clamp()`, `min()`, and CSS grid template variables in `App.tsx` (`--sidebar-width`, `--inspector-width`, `--board-size`). **Without screenshots**, specific breakpoints (e.g. small laptops with inspector + sidebar open) should be checked for horizontal overflow or clipped tabs.
- Vite dev server is bound to **`127.0.0.1`** only (`vite.config.ts` `server.host`). Remote devices on the LAN **cannot** open `http://<lan-ip>:5173/` — expected for security, but note for mobile responsive testing.

---

## Summary counts

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 2 |
| Medium   | 4 |
| Low      | 3 |
