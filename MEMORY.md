# MEMORY.md — Smart Image Archive

## Current Phase

MVP COMPLETE (8 phases) + full-functionality pass DONE + LAYOUT/FIDELITY & CREATIVE SCREEN PASS DONE. FACETED SEARCH DONE — implemented the CHI 2003 paper "Faceted Metadata for Image Search and Browsing" (Yee et al.): dynamic query previews, no-dead-ends, the Matrix sidebar, group-by-facet, endgame links with counts, keyword disambiguation. 6 screens (dashboard, upload, detail, search, collections, settings&help).

## Implemented Features

- **Faceted search (Matrix)** — `GET /api/facets` returns Tag/Type/Date counts for any search context (shared `buildSearchContext(req)` WHERE builder powers both `/api/search` and `/api/facets`, so counts always annotate the exact result set — no dead-end links). Client `components/FacetPanel.jsx` renders the Matrix (hue-coded rows, active state, always-visible counts); Dashboard right panel + Search view both host it during an active query (Recent Tags still shows otherwise).
- **Facet filters** — repeatable `tag` (`string_to_array(tags,' ') @> ARRAY[n]`, ANDed across tags), `type` (jpg incl. jpeg / png / raw), `dateFrom`/`dateTo` (ISO, dateTo exclusive) all AND on top of keyword search. Toggling re-fetches results + facets in lock-step.
- **Group-by-facet** — client-side grouping of the ≤100 results (Tag/Type/Date) via "Group:" select on Dashboard + Search.
- **Endgame links** — Detail tag chips navigate to `/?q=tag`; `GET /api/tags/count` (exact, library-wide, excludes soft-deleted) feeds count badges on each chip.
- **Keyword disambiguation** — `GET /api/tags/suggest?q=` (prefix LIKE on lower(tags), `%_\` escaped, LIMIT 10); Taskbar shows a debounced dropdown under the input, clicking replaces the query.
- **AI button** in Detail view's Tags header (deviation: design has no literal tabs section — bound next to the "Tags" label in the Metadata & Tagging panel, where the active image + tags live)
- **Left-click**: canvas-downscales active image to ≤512px JPEG base64 → `POST /api/images/tag` with saved master prompt → tag chips update live; canvas taint (CORS) auto-falls back to server-side `imageUrl` fetch
- **Right-click**: `preventDefault()` → modal to view/edit/save master prompt (persisted in localStorage, default "Give me 5 descriptive keywords for this image.")
- Tagging state (disabled pill + "Tagging..."), inline error line, click-backdrop-to-close modal
- Verified: build ✓, dev server ✓, dummy-key call reached Google API (rejected on key only) — full chain proven; client api.js tagImage()
- `POST /api/upload-url` — validates filename + ext whitelist (jpg|jpeg|png|webp|gif|heic|tiff|raw), returns `{objectKey, uploadUrl}` (60s expiry, presigned PUT w/ ContentType)
- object_key: `uploads/{uuid}{ext}` — server-side UUID only, user filename never touches the key
- Upload view wired: drag-over highlight, drop + Browse Files → per-file presigned PUT, live status queue (uploading/done/error)
- Verified: 400s for missing filename/bad ext, 500 when R2 unconfigured, 200 + valid AWS4 presigned URL with dummy creds
- `images` table: id (uuid gen_random_uuid), object_key (unique), original_filename, tags (TEXT default ''), favorite (BOOLEAN default false), deleted (BOOLEAN default false, soft delete), created_at
- `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(tags,''))) STORED` + GIN index
- Verified: generated column populates, @@ match + ts_rank() ordering works
- Search route supports `?sort=rank|newest|oldest`; searches exclude soft-deleted rows
- Extracted `stitch_remix_of_newsroom_asset_index.zip` (4 HTML views + DESIGN.md)
- React client (Vite) rebuilt from extracted design, not from scratch:
  - Dashboard (search bar, sidebar, masonry gallery, right tag panel)
  - Upload (drag-and-drop zone)
  - Detail (image viewer + Metadata & Tagging panel)
  - View routing via App.jsx state machine (dashboard | upload | detail)
- Express backend skeleton with `/api/health`
- Deps installed: express, pg, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @google/genai, cors, dotenv (server); react, vite (client)

## Architecture Decisions

- Tailwind now LOCAL (CDN removed — CDN froze the page): tailwind.config.js + postcss.config.js in client, src/index.css with @tailwind directives + masonry/photo-card/progress/scrollbar styles; index.html keeps fonts only
- No UI rebuild from scratch — faithful JSX conversion of code.html assets
- Vite proxy `/api` → localhost:3000 (no CORS friction in dev; cors middleware also on)
- DB data is the single source of truth (3 seed rows inserted for demo: seed/rally-downtown.jpg, seed/activist-portrait.jpg, seed/storm-damage.jpg)
- No tabs section exists in the design — Phase 8 AI button binds next to the "Tags" label in Detail view's Metadata & Tagging panel
- View routing via App.jsx state machine (dashboard | upload | detail | search | collections | settings); detail remembers `detailFrom` for correct Back; detailList context = prev/next within any list (search results, collections)
- Collections + Saved Searches + Feedback stored in localStorage via client/src/store.js (newsweekly_* keys)
- 'simple' tsvector config — exact-word matching, no stemming (verified: 'america' does not match 'americas')
- DB runs in Docker (`smart-archive-db`); restart with `docker start smart-archive-db`

## Key Files

- server/src/index.js — Express app (health, upload-url, images list/patch/delete, search, tag routes)
- server/src/r2.js — R2 S3 client + isR2Configured guard
- server/src/gemini.js — GoogleGenAI client + guard
- server/src/tagParser.js — lenient JSON-array tag parser
- client/src/api.js — getUploadUrl, uploadFile, saveImage, listImages, updateImage, deleteImage, searchImages, tagImage
- server/src/db.js — pg Pool
- server/src/schema.sql — images table + favorite/deleted + GIN index
- server/src/initDb.js — applies schema (`npm run db:init`)
- server/.env — local dev DB creds (gitignored)
- client/src/App.jsx — view state machine (dashboard|upload|detail|search|collections|settings) + data layer (loadImages on filter, patchImage/removeFromList, quickTag, pendingBatch handoff search→collections)
- client/src/views/Dashboard.jsx (live gallery, sidebar filters All/Recent/Favorites/Collections/Trash, WORKING Date/Type/Orientation dropdowns w/ image-dimension measurement for orientation, Quick Actions Export JSON/Share link, recent tags w/ counts, quick-tag, Cmd+K, toast)
- client/src/views/Upload.jsx (drag&drop, live status queue)
- client/src/views/Detail.jsx (prev/next, tag add/remove, favorite, download, trash, WORKING zoom in/out/Fit + click-to-zoom, keyboard ←/→/Cmd+T/Esc, Add-to-Collection picker modal, AI button)
- client/src/views/Search.jsx (query, term chips, date-range radios 24h/week/custom, type checkboxes, sort, per-card star/download/select checkboxes, functional Save Search + saved list, batch-selection → collections)
- client/src/views/Collections.jsx (NEW — cards w/ covers, create/open/delete, empty states, batch-add banner)
- client/src/views/Settings.jsx (NEW — API status check, master prompt editor, keyboard shortcuts, feedback form + history)
- client/src/store.js — localStorage helpers (collections, savedSearches, feedback)
- client/src/components/Avatar.jsx — topnav avatar (person glyph, design has real photo)
- client/tailwind.config.js, postcss.config.js, src/index.css — local Tailwind (no CDN)
- client/index.html — fonts only
- Design source: `stitch_remix_of_newsroom_asset_index/` (extracted)

## Required Env Vars (names only — server/.env.example)

PORT, DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL, GEMINI_API_KEY

## Known Issues

- R2 creds not yet provided — real uploads will fail until R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME are set in server/.env
- GEMINI_API_KEY not yet provided — AI tagging returns an error until set in server/.env
- Seed images (design placeholders) are CORS-tainted → AI tagging on seed items falls back to imageUrl path, which needs a fetchable URL; real R2-hosted uploads work fully
- object_key contains slashes (`seed/rally-downtown.jpg`) → API path params MUST be URL-encoded (client api.js already does encodeURIComponent)
- Smart-archive DB container can stop on its own — `docker start smart-archive-db` before `npm run db:init` or dev

## Run Instructions

1. `docker start smart-archive-db` (if not running)
2. `server`: npm run dev → :3000 (set R2 + GEMINI creds in server/.env first)
3. `client`: npm run dev → :5173

## Next Phase

Faceted search shipped (server + client, 58/58 tests, live smoke-verified). NOT pushed to GitHub (user's Railway auto-deploys on push — only push when told). Optional follow-ups: batch AI tagging, R2 creds to go live with uploads, collections→DB persistence (currently localStorage), resume main-pc remote deploy (Tailscale offline when last attempted; partial state at ~/smart-image-archive on that host).
