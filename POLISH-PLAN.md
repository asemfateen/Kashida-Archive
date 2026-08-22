# Ultimate Ultra Polish — Execution Plan

## Scope
Target: `/home/asem/backups/laptop-20260817/node js`
All changes local-only, no `git push`. Every change is additive/enhancement — core logic untouched.

---

## Phase 1: Quick Wins — Dead Code, Config Cleanup, Easy Fixes

### 1A. index.html — Fix FOUC
- Change `<html class="light"` to `<html class="dark"` (or add inline script to read localStorage/OS preference before paint)
- **File**: `client/index.html:2`

### 1B. Remove Dead Code
- Delete `client/src/views/Collections.jsx` (295 lines, unreachable)
- Remove `export { VIEWS }` from `client/src/App.jsx:576`
- Remove unused `isDark` destructuring in `client/src/views/Login.jsx:9`
- Remove unused `useRef` import from `client/src/auth.jsx:7`
- Remove dead `.dark .border-outline-variant` duplicate in `client/src/index.css:364-366`
- Remove dead `img[loading="lazy"].loaded` selector in `client/src/index.css:508`
- Remove redundant `transitionDuration` block in `client/tailwind.config.js:198-203`
- Remove redundant `fontFamily` aliases in `tailwind.config.js:111-116` (keep `sans`, `serif`, `mono`, `display`, `mono-data`; remove `headline-md`, `body-sm`, `body-md`, `label-caps`, `title-sm`, `display-lg`)

### 1C. Shared Constants — Eliminate Duplication
- Create `client/src/constants.js` with:
  - `DEFAULT_PROMPT` (from Detail.jsx:13 / Settings.jsx:6 / Ai.jsx:18)
  - `GROUP_TYPE_LABELS` (from Dashboard.jsx:14 / Search.jsx:5 / FacetPanel.jsx:1)
  - `IMAGE_EXTENSIONS` whitelist (from Upload.jsx:48)
- Update all 5 files to import from constants.js

### 1D. Login Accessibility
- Add `htmlFor="username"` / `id="username"` to username label/input
- Add `htmlFor="password"` / `id="password"` to password label/input
- **File**: `client/src/views/Login.jsx:52-75`

---

## Phase 2: Dark Mode Consistency

### 2A. Ai.jsx QueueSection Accent Colors
Add `dark:` variants to all 4 accent prop strings:
- Line 797: `+ dark:bg-amber-900/30 dark:text-amber-400`
- Line 808: `+ dark:bg-rose-900/30 dark:text-rose-400`
- Line 819: `+ dark:bg-emerald-900/30 dark:text-emerald-400`
- Line 841: `+ dark:bg-gray-800/30 dark:text-gray-400`

### 2B. Ai.jsx Toast Dark Mode
- Line 889: Change `bg-on-surface dark:bg-dark-on-surface` to design-system token

### 2C. Settings.jsx Row Component
- Extract `Row` outside of `Settings` component to prevent remounting on every render

---

## Phase 3: Frontend Performance

### 3A. App.jsx — Deduplicate Shell/ProfileShell
- Extract `<Layout>` component (~20 lines) accepting `children` render prop
- Both `Shell` and `ProfileShell` become thin wrappers
- Eliminates ~40 lines of duplication

### 3B. App.jsx — Memoize Callbacks
- Wrap `go`, `goBack` in `useCallback`
- Wrap `onFavorite`, `onRestore`, `onChanged`, `onUpdated`, `onDeleted`, `onBack`, `onUpload`, `onSettings` in `useCallback`

### 3C. Dashboard.jsx — Extract PhotoCard
- Extract `renderCard` (lines 432-574, 142 lines) as `React.memo(PhotoCard)` component
- Pass individual props instead of whole Set for `selected`
- Fix inline DOM manipulation in `onError` handler (line 460-467)
- Move `normalize()` and `groupKeyOf()` outside component body as module-level pure functions

### 3D. Dashboard.jsx — Memoize Derived Data
- `tagCounts` Map (lines 385-393) → `useMemo`
- `selectedItems()` (line 213-214) → `useMemo`
- `galleryItems` / `groupedGroups` → ensure already memoized

### 3E. FacetPanel.jsx — Batch Clear
- Add `onClearAll` prop instead of firing N individual toggles
- Parent handles clearing all facets in a single state update

### 3F. Upload.jsx — Batch State Updates
- Batch file additions into single `setUploads` call instead of per-file in `.map()`
- Lines 71-75

---

## Phase 4: Backend — Safety & Performance

### 4A. Batch R2 Deletion
- Replace sequential `DeleteObjectCommand` loops with `DeleteObjectsCommand` (batches of 1000)
- **Files**: `server/src/index.js:537-549` (batch-delete) and `679-698` (trash empty)

### 4B. Thumb Generation Memory Guard
- Add byte counter during `for await` streaming in thumb endpoint
- Skip source images > 50MB, return 413
- **File**: `server/src/index.js:380-382`

### 4C. AI Queue Image Size Guard
- Same byte counter in `loadImageData`
- Skip images > 50MB, mark job failed with descriptive error
- **File**: `server/src/aiQueue.js:221-234`

### 4D. Missing Rate Limiters
- Add `RATE_TAG` to `POST /api/images` (image creation) — `server/src/index.js:196`
- Add `RATE_AI_JOBS` to `POST /api/ai/tag-all-untagged` — `server/src/index.js:1149`
- Add `RATE_AI_JOBS` to `POST /api/ai/jobs/cancel-all` — `server/src/index.js:1289`

### 4E. Health Endpoint
- Return HTTP 503 when `db: false` instead of 200
- **File**: `server/src/index.js:104-107`

### 4F. Schema — Add Index
- Add `images_untagged_idx` partial index for `ai_tagged = false AND deleted = false`
- **File**: `server/src/schema.sql`

### 4G. CORS Hardening
- Read allowed origins from `ALLOWED_ORIGINS` env var (comma-separated)
- Default to `*` for dev, restrict in production
- **File**: `server/src/index.js:65`

---

## Phase 5: Error Handling & Resilience

### 5A. Unhandled Rejection Handler
- Add `process.on("unhandledRejection")` in `server/src/index.js` at startup
- Log and continue (don't crash)

### 5B. AI Queue Resilience
- Add outer try/catch to `processJob` to prevent drain loop from crashing on DB errors
- Mark job `failed` on unexpected errors instead of leaving it stuck in `running`
- **File**: `server/src/aiQueue.js:279-343`

### 5C. Stream Error Handling
- Improve serve/thumb stream error handlers to avoid `res.status()` after headers sent
- Use `res.destroy()` pattern for mid-stream failures
- **File**: `server/src/index.js:319-322, 354-357`

---

## Verification
- `npm test` in `server/` — all 59 tests pass
- `npx vite build` in `client/` — clean build
- `node --check src/*.js` in `server/` — syntax OK
