---
name: mindkeep-run
description: Launch and drive Mindkeep (this app) in an isolated instance to manually test or screenshot a change — never against the user's real database or vault encryption key. Use when asked to run, test, or screenshot Mindkeep, or to verify a UI/UX change actually works before calling it done. NOT for the automated test suite (use `npm test`), and NOT a substitute for reading server/routes code when the question is about API behavior rather than the rendered UI.
---

# Running Mindkeep for manual/visual verification

Mindkeep is a personal, self-hosted Express + vanilla-JS app (no build
step) with a real password vault. `data/mindkeep.db` and
`data/.secrets.env` hold the user's actual encrypted passwords and
encryption keys. **Never launch the app against those files.** Always
run an isolated instance and tear it down when done.

## 1. Launch an isolated instance

```bash
PORT=3911 \
DB_PATH=":memory:" \
SESSION_SECRET="test-secret-only-for-local-visual-check" \
ENCRYPTION_KEY="test-enc-key-only-for-local-visual-check" \
node server/index.js > /path/to/scratchpad/server.log 2>&1 &
timeout 20 bash -c 'until curl -sf http://localhost:3911/api/health >/dev/null; do sleep 1; done'
```

- `DB_PATH=:memory:` (read in `server/db.js`) is what makes this safe —
  a fresh empty SQLite DB per run, gone when the process dies.
- `SESSION_SECRET`/`ENCRYPTION_KEY` as real env vars stop
  `server/secrets.js` from touching `data/.secrets.env` (it only writes
  there when a value is genuinely missing from both `process.env` and
  the persisted file — but don't rely on that, just always pass dummy
  values explicitly).
- Pick a `PORT` that isn't the user's real instance (3000 by default).
- After you're done, kill whatever's listening on that port — don't
  leave a stray node process around.
- Sanity check afterwards: `data/mindkeep.db` and `data/.secrets.env`
  mtimes should be untouched (`ls -la data/`).

## 2. Get a browser

No `chromium-cli` and no `playwright` dependency in this repo as of
this writing. Install Playwright's browser + package into the
**scratchpad directory**, not the project (`npm init -y && npm install
playwright` there, then `npx playwright install chromium` once — the
browser binary is cached at `~/AppData/Local/ms-playwright` and is
reused across sessions, so this is a one-time cost). Drive it with a
small throwaway script, not `chromium-cli`.

## 3. The UI flow (needed for any script)

1. `page.goto(BASE)` → a language picker always shows first
   ("Scegli la lingua"): click the `Italiano` (or `English`) button.
2. Then either a **first-run form** ("Primo avvio: crea il tuo accesso
   personale" — username + password + "Crea accesso") if the DB is
   fresh, or a **login form** (username + password, possibly a TOTP
   code) if a user already exists in this instance. Same selectors
   work for both: `input[type="password"]:visible`,
   `input[name="username"]:visible`, `button[type="submit"]:visible`.
3. After submit, the desktop loads: taskbar at the bottom with "Avvio"
   (Start), a search icon, a "+" quick-capture icon, and open-window
   tabs. To open a view: click Avvio, then click the nav item by its
   Italian label (e.g. `text=Progetti`) — the label text is whatever
   `tr('nav_*')` resolves to in `public/i18n.js`.

## 4. Mobile viewport — real gotcha

**Open a fresh browser context at the target mobile viewport from the
start** (`browser.newContext({ viewport: { width: 390, height: 844 } })`
then log in inside that context). Do **not** log in at desktop size and
then call `page.setViewportSize()` to shrink an already-open window —
the window manager (`public/wm.js`) doesn't re-run its mobile layout
logic on a live resize, so the window keeps its desktop pixel width and
the page overflows horizontally. That overflow is a test artifact, not
a real bug — don't report it as one.

## 5. One representative interaction + screenshot

Whatever you're checking, drive it to something a user would actually
see, e.g. for a Projects/board change: Avvio → Progetti → "+ Nuovo
progetto" → fill title/description/deadline/checklist → save →
screenshot. Always call `console` error checking
(`page.on('console', ...)` collecting `type()==='error'`) before
declaring success — a blank/broken fetch can render a normal-looking
shell.

## Gotchas already hit

- `npx chromium-cli` is not available in this environment — don't try
  it first, go straight to a local Playwright install.
- The language picker is easy to miss if you only grep for password
  fields — always handle it as step 1.
- `input[type=password]` can exist in the DOM twice (login vs.
  first-run templates both present, one hidden) — always scope
  locators with `:visible`.
