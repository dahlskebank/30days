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
3. **Sound modes shipped for A/B testing** (v1.1.6): single voice channel,
   System → "Smart burst" toggle. ON = mode C (new sample interrupts, but
   taps within 600ms of a started quote fall back to synth blips; milestone
   sounds always interrupt). OFF = mode A (every tap interrupts with a new
   quote). Owner is testing which to keep — see `mode`/`BURST_MS` in sound.js.
4. GA4: `window.GA_ID` in index.html is empty; paste id to enable.
5. Empty sound slots: allpassive, allbonus, fail, initiate (SOUNDS.md).
6. "Reset protocol" testing row: disable before real go-live.
7. OG image (`assets/img/og-image.jpg`) regenerated with "OF DISCIPLINE";
   source template lives in the session scratchpad only — regenerate by
   screenshotting a 1200×630 HTML page with the site's fonts/tokens.
8. **Design decisions resolved in v1.1.7:**
   - Tier marks: text tags REMOVED; tier lives in the triangle (core = gold
     outline, bonus = micro-hex docked at the corner via `.mhex`, passive =
     grey outline until checked). Owner is evaluating ("test suggestion B").
   - Header hide-on-scroll: tried in v1.1.7, REVERTED in v1.1.8 — the solid
     backdrop the overlay needed blanked the bg layers behind the topbar
     ("style over substance"). initHeadHide() kept but disabled (ENABLED
     flag); header is a normal pinned flex row again.
   - App rename: DISABLED in v1.1.8 ("Protocol sounds cool") — System row
     hidden, header pinned to "Protocol"; wiring kept for re-enable.
   - Install-app System row: HIDDEN in v1.1.8 (kept wired for the future).
   - Loadout sheet has a Done button at the bottom (closes, same as ✕).
   - Toast: width:max-content fix — left:50% shrink-to-fit was wrapping
     short messages at ~half viewport width.
   - Rule notch stays MONTH progress (owner confirmed).
   - Smart burst DEFAULTS OFF (soundMode default "interrupt"; stored
     values are respected, so previously-saved "smart" states keep it on
     until toggled in System).
   - Gauge big count stays CORE-only by design (bonus = cells, passive =
     triangle; a 10/4-style total was considered and rejected).
   - `_site/sounds/DK/` (FX64.mp3, FX99.mp3): files dropped by owner, not
     wired to any event yet — ask what they're for.
9. **Production deploy still pending** (owner runs it): `DRY_RUN=1
   ./deploy.sh _site` then `./deploy.sh _site` — fixes missing /icons/,
   old .htaccess, per-browser version skew; then clear site data once per
   affected browser. Domeneshop LE cert for kiande.com still needed.

## Conventions

- Tabs for indent; Daniel runs Prettier on save sometimes (match whatever
  the file currently uses; Edit anchors must match exactly).
- Educational comments in code are wanted (Daniel is learning).
- WTFPL license. Footer identity: © 1983 ⌁ <year> → KiAnDe.com · vX.Y.Z
  (footYear/footVersion filled by app.js from APP_VERSION).
- Inline `// VERIFY:` comments mark the owner's on-device test checklist
  (from SPEC §13) — keep them.
- memory: see kiande-30-days-of-dahl.md in Claude's project memory.
