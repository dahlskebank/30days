# HANDOFF — 30 Days of Discipline (kiande.com)

> Orientation doc for continuing work in a fresh Claude session.
> Last updated 2026-07-05 (v1.1.5). Read this + README.md + SOUNDS.md;
> SPEC.md governs the tier/streak/protocol MATH but is superseded on
> navigation/presentation (see "Where the spec was overruled").

## What this is

Single-user daily discipline tracker PWA in Deus Ex: Human Revolution
style (black/gold, hexagons, triangles). Vanilla HTML/CSS/JS, **no build
step** — `_site/` is hand-authored source AND the web root, committed to
git. Repo: https://github.com/dahlskebank/30days (public). Lives at
kiande.com (Domeneshop shared hosting, Apache).

## Architecture (post-overhaul)

- `_site/index.html` — one page: fixed-viewport app shell (topbar + rule +
  swipe viewport + nav) + desktop landing (`.deck`, ≥992px hides the app
  entirely). All overlays are in the HTML: System offcanvas (left drawer),
  Loadout bottom sheet, day-editor HUD, confirm HUD, shared scrim.
- `_site/app.js` — orchestration. Key pieces: `initSwipe()` (pointer-events
  swipe between 3 tab screens in `.track`, pointerId-keyed, cancel-safe),
  `showTab()` (also sets `inert` on off-screen tabs), `renderAll()` after
  every mutation, `openOverlay/closeOverlay` (hide-timer + scrim `.raised`
  for confirm modality), `applySettings()` (sound/fx/marksRight/brandName).
- `_site/model.js` — pure logic. Protocol status is ALWAYS derived from the
  log (`protocolStatus`), never stored. `protocolWindow` truncates FAILED
  runs to their lived days for calendar markers.
- `_site/storage.js` — ALL localStorage access (key `thirtyDaysOfDahl.v1`),
  schema migration scaffolding, corrupt-data stash (`.corrupt` sidekey),
  import/export validation.
- `_site/sound.js` — event → mp3 pool map (`SFX`), synth fallback. See
  SOUNDS.md for inventory + empty slots.
- `_site/fx.js` — boot sequence, decode text, check burst, cascade,
  ambient shard, gyro/pointer parallax. Everything behind `state.fx` +
  `prefers-reduced-motion` (body.fx-off halts pure-CSS animations).
- `_site/sw.js` — cache-first shell. **Bump `CACHE` on every deploy.**
  Core shell is atomic addAll (with a 404-naming diagnostic on failure);
  sounds are cached best-effort. Navigations serve cached "/".
  app.js reloads once on controllerchange → deploys appear on first visit.

## Product rules that differ from SPEC.md

- **No abort.** Protocols only FAIL (any committed in-window day <100%
  core) or SUSTAIN (30 clean days; day counter keeps climbing). FAILED →
  "Start over" (archives, starts new run today). "Reset protocol" in
  System is a TESTING helper (deletes run traceless) — disable at go-live.
- Failed runs mark only start→breaking-day red on the calendar.
- Tabs swipe (no flicker transition); System/Loadout are panels, not
  full-screen view swaps; no BACK button.
- Name: site identity "30 Days of Discipline", in-app brand default
  "Protocol" and user-editable (System → App name → `state.brandName`);
  manifest/installed label stays "Protocol" (can't be dynamic).
- The header hairline's triangle notch = current month progress (set in
  renderToday via CSS var `--rp`).
- Hive layout: 5 rows × 6 hexes, even rows offset half a hex.

## State schema (v1)

`{ schema, rolloverHour(5), sound, fx, marksRight, brandName, groups:[{id,
name, tasks:[{id,label,tier:core|bonus|passive}]}], log:{"YYYY-MM-DD":[taskId]},
protocols:[{id,start,archived?,aborted?}], earliest, lastBackupNudge }`
Std tasks carry fixed `std_*` ids so "Restore standard" can merge.
"Today" = now − rolloverHour, wall-clock math (DST-safe).

## Local dev

- Laragon vhost `E:\vlaragon\etc\apache2\sites-enabled\kiande.conf` →
  doc root `_site/`; hosts line `127.0.0.1 kiande.com` (currently
  commented out in Daniel's hosts to test production).
- Local HTTPS needs the dedicated cert trusted ONCE (admin):
  `certutil -addstore Root E:\vlaragon\etc\ssl\kiande.crt`
  (the shared laragon.crt has no kiande.com SAN → Chrome silently blocks
  the service worker — that was the original "install doesn't work" bug).
- Quick loop without Apache: `npx http-server _site -p 8321 -c-1` —
  SW also registers on localhost.

## Deploy (Domeneshop)

- `./deploy.sh _site` (lftp mirror --reverse --delete, config in `.env`:
  dxdno@login.domeneshop.no → /home/6/d/dxdno/kiande.com, key
  `/e/www/dd_db_domeneshop`). ALWAYS `DRY_RUN=1 ./deploy.sh _site` first.
- Bump `CACHE` in sw.js (and `APP_VERSION` in app.js + footVersion in
  index.html) per deploy.
- HTTP caching is currently DISABLED in `.htaccess` (global no-cache)
  for the test phase — re-enable block is commented inline, marked
  "RE-ENABLE AT LAUNCH".

## Known open items (as of 2026-07-05)

1. **Production is stale/partial**: `/icons/` folder missing (404s → SW
   addAll fails → install offered only as shortcut), old `.htaccess`
   still live (max-age=86400 → per-browser version skew: Samsung had the
   old-but-working build, Chrome/Firefox a broken mix). FIX = one full
   `./deploy.sh _site`, then clear site data once per affected browser.
2. **Production TLS**: kiande.com serves the dxd.no certificate (no LE
   cert issued yet) → SW/install blocked on prod until fixed in the
   Domeneshop panel (SSL for kiande.com).
3. **Sound stacking** (rapid taps overlap samples): brainstormed, not yet
   implemented — owner wants to choose the approach.
4. GA4: `window.GA_ID` in index.html is empty; paste id to enable.
5. Empty sound slots: allpassive, allbonus, fail, initiate (SOUNDS.md).
6. "Reset protocol" testing row: disable before real go-live.
7. OG image (`assets/img/og-image.jpg`) regenerated with "OF DISCIPLINE";
   source template lives in the session scratchpad only — regenerate by
   screenshotting a 1200×630 HTML page with the site's fonts/tokens.

## Conventions

- Tabs for indent; Daniel runs Prettier on save sometimes (match whatever
  the file currently uses; Edit anchors must match exactly).
- Educational comments in code are wanted (Daniel is learning).
- WTFPL license. Footer identity: © 1983 ⌁ <year> → KiAnDe.com · vX.Y.Z
  (footYear/footVersion filled by app.js from APP_VERSION).
- Inline `// VERIFY:` comments mark the owner's on-device test checklist
  (from SPEC §13) — keep them.
- memory: see kiande-30-days-of-dahl.md in Claude's project memory.
