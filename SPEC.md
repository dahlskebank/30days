# 30 DAYS OF DAHL — Build Specification

**Version:** 1.0 · **Date:** 2026-07-04
**Deliverable owner:** Daniel Dahl
**Builder:** Claude Code (Fable)
**Visual reference:** `protocol-dxhr-v3.html` (attached mockup — match its look and feel; this spec supersedes its logic)

---

## 0. What this is

A single-user, forever-running daily discipline tracker, styled after the **Deus Ex: Human Revolution** UI (black + gold, chamfered corners, hexagons, triangle shards, Eurostile-lineage type). Based on *30 Days of Discipline* by Victor Pride. The owner checks off a fixed daily loadout; the app records every day forever; an optional 30-day "protocol" (challenge window) can be initiated, which is strictly pass/fail.

**Brand:** "30 DAYS OF DAHL" (header: `30 DAYS` large, `OF DAHL` as the gold sub-line).
**Terminology:** a challenge run is called a **protocol** (initiate / fail / sustain). Never "challenge" in UI copy.

---

## 1. Tech constraints (fixed — do not deviate)

- **Vanilla HTML/CSS/JS.** ES modules. No framework, no build step, no dependencies.
- **Mobile-first, phone only.** Single column, max-width 480px centered, 44px+ touch targets, `env(safe-area-inset-*)` respected.
- **Installable PWA:** real `manifest.webmanifest`, real `sw.js` (cache-first app shell), full icon set. Works fully offline after first load.
- **Hosting:** static files on Apache (Domeneshop), deployed at the root of **kiande.com**. PWA scope `/`. No server code in phase 1.
- **Fonts self-hosted** (no Google Fonts runtime dependency): **Rajdhani** (500/600/700) for display/numerals, **Chakra Petch** (400/500/600) for labels/body. WOFF2 in `/fonts`, `font-display: swap`, system fallbacks declared.
- **Dark mode only.**

### File layout

```
/index.html          app shell (all views, minimal inline critical CSS ok)
/styles.css
/app.js              entry: init, router (view switching), render orchestration
/storage.js          ALL persistence behind get/save/migrate API (see §3)
/model.js            date math, tier stats, streak, protocol status derivation
/sound.js            Web Audio synth blips
/fx.js               animations: boot sequence, decode text, parallax/gyro
/sw.js
/manifest.webmanifest
/fonts/              rajdhani-*.woff2, chakra-petch-*.woff2
/icons/              192, 512, maskable variants, apple-touch-icon, favicon
SPEC.md              this file
```

Keep modules small and boring. No bundling; `<script type="module" src="app.js">`.

---

## 2. Views & navigation

Three tabs in a fixed bottom bar (DXHR pill style: chamfered, hatched left edge, active = filled gold with dark text):

**TODAY · 30 DAYS · CALENDAR**

Two additional **full-screen views** (NOT bottom sheets — DXHR menus are full-screen takeovers):

- **LOADOUT** (task/group editor) — entered from Today ("⌁ Edit loadout" ghost button) or System.
- **SYSTEM** (settings) — entered from the hex-gear icon in the top bar.

Full-screen views replace the content area (view swap, no URL routing), hide the tab bar, and provide a chamfered **◄ BACK** button pinned bottom-left (echoes the game's B/BACK prompt). Transition per §9.

The **day editor** (backfilling a past day) is the one exception: a quick overlay panel, but restyled from "rounded mobile sheet" to a hard-edged chamfered HUD panel that snaps in (no rounded grab handle).

---

## 3. Data model & storage

### 3.1 Schema (v1)

```js
{
  schema: 1,                       // REQUIRED. bump on any breaking change
  rolloverHour: 5,                 // 0–23, default 5
  sound: true,
  fx: true,                        // master toggle for animations/parallax
  groups: [                        // ordered
    { id, name, tasks: [           // ordered
      { id, label, tier }          // tier: "core" | "bonus" | "passive"
    ]}
  ],
  log: { "YYYY-MM-DD": [taskId, ...] },   // done sets, keyed by effective date
  protocols: [                     // FULL HISTORY, never deleted implicitly
    { id, start: "YYYY-MM-DD" }    // status is always DERIVED, never stored
  ],
  earliest: "YYYY-MM-DD",          // first tracked day
  lastBackupNudge: "YYYY-MM-DD"    // for §11 backup reminder
}
```

### 3.2 storage.js contract

- `load()` → state (runs `migrate()` if `schema < CURRENT`), `save(state)`, `exportJSON()`, `importJSON(text)` (validates shape, migrates, rejects garbage with a clear toast).
- localStorage key: `thirtyDaysOfDahl.v1`. Request `navigator.storage.persist()` on first run.
- **Migration scaffolding must exist from day one** (a `migrations = {1: fn, ...}` map), even though v1 has nothing to migrate. This app runs forever; the format won't.
- **Phase 2 note (do not build):** the module boundary exists so persistence can later be swapped for a small PHP+SQLite sync endpoint on the same host. Nothing outside `storage.js` may touch localStorage directly.

### 3.3 Effective date & rollover

"Today" = `now − rolloverHour` hours, floored to local midnight. Before 05:00 it is still yesterday. All log keys use effective dates. Changing rollover hour re-renders but never rewrites the log.

---

## 4. Tier system (the core mechanic)

Three tiers, DXHR augmentation semantics:

| Tier | Meaning | Counts toward | Indicator |
|---|---|---|---|
| **CORE** | The 100% daily minimum | Charge bar (0–100%) and streak | main bar segments |
| **BONUS** | Overcharge beyond the minimum | Nothing required; pure surplus | hex **energy cells** right of/under the bar, lit gold when done |
| **PASSIVE** | Standing rules; should be done, count for nothing | Nothing | ONE **triangle** indicator, right of the overcharge cells: grey outline normally, **solid gold only when ALL passive tasks are checked** (all-or-nothing — passives are online or they're not) |

- Charge % = coreDone / coreTotal. Bonus and passive never move it.
- Day states: OFFLINE (0) → BOOTING → ACTIVE → CHARGED → **AUGMENTED** (100% core) → **OVERCLOCKED** (100% + ≥1 bonus).
- If coreTotal is 0 (user deleted all core tasks), treat any checked task as 100% and show a subtle warning in Loadout ("No core tasks — every day counts as complete").
- Heat color ramp (interpolated): `#1a1712 → #4a3416 → #8a5a1a → #d8952e → #ffe9b8`. Applied to day hexes/cells by core ratio; OVERCLOCKED days glow stronger (box-shadow scales with bonus count).

### Symbol grammar (strict — do not mix)

- **Hexagon = time & energy** (day tiles, overcharge cells, logos, toggles).
- **Triangle = action & state** (task checkmarks, the passive indicator, nav notches, CTA arrows). The task checkbox is a **triangle**: thin gold outline unchecked → solid gold fill + small glow when checked (the ▲ from the DEUS EX HUM▲N logo). Replaces the v3 hex checkbox entirely.

---

## 5. Default loadout (seeded on first run)

Standard tasks carry **fixed ids** (`std_*`) so "Restore standard" can merge. Tiers below are the owner's decisions plus proposed mappings he will adjust in the editor.

```
TRAINING (id: std_g_training)
  std_pushups   "100 pushups"                     core
  std_situps    "100 situps"                      core
  std_squats    "100 body squats"                 core

ROUTINE (id: std_g_routine)
  std_wake      "Wake at 05:00"                   core
  std_cold      "Cold shower"                     bonus
  std_meals     "3 meals max — no snacking"       passive
  std_dress     "Dress your best"                 passive
  std_nofap     "No porn, no fap"                 passive
  std_posture   "Posture + eye contact"           passive
  std_notebook  "Notebook & pen on you"           passive

WORK (id: std_g_work)
  std_todo      "Complete today's to-do list"     passive
  std_goal      "One step toward the goal"        passive
```

First run: seed this loadout, empty log, no protocols, `earliest` = today. **No fake history in production.**

**"Restore standard loadout"** (in Loadout view): re-adds any missing `std_*` tasks into their `std_g_*` groups (recreating groups if deleted), preserves the user's tier changes ONLY for tasks that still exist, never touches custom tasks, never duplicates. Confirm dialog before running.

---

## 6. View specs

### 6.1 TODAY

- Header row: protocol day mark (`DAY 14 / 30`, `DAY 43 · SUSTAINED`, or `FREE RUN` when no active protocol) + effective date.
- **Gauge panel** (chamfered, gold corner bracket): big `coreDone / coreTotal` numeral; CHARGE % + state word (color = heat ramp); the slant-ended charge bar with per-core-task tick marks; below it the **overcharge hex cells** (one per bonus task, `title` = task label) and, to their right, the **passive triangle** indicator with a small "PASSIVE" cap label.
- Task groups in user order; each task row: triangle checkmark (left), tier tag for non-core (`BONUS` gold-outlined / `PASSIVE` grey, small), label right-aligned, hatched left edge on the pill. Whole row toggles.
- Ghost button at bottom: `⌁ EDIT LOADOUT` → Loadout view.

### 6.2 30 DAYS

**No active protocol:** hex logo "30", copy ("Commit to a 30-day window. The log runs either way — the protocol is the crucible."), gold CTA **INITIATE PROTOCOL** (starts today; confirm dialog).

**Active protocol:** derive status every render (§7). Show:
- Eyebrow: `PROTOCOL · <start> → <start+29>` (+ status word when FAILED/SUSTAINED).
- Big streak numeral (gold gradient; grey when 0), `DAY STREAK` label, stats line: `best N · augmented X/Y · avg charge Z%`.
- **Honeycomb billet:** 30 hexes, rows 6-5-6-5-6-2, offset. Committed days heat-colored; 0% days = cracked red (`#2c120e` + red hatch); today ringed white-gold; future = dashed outline. FAILED protocols: the breaking day gets a distinct fracture treatment (heavier red hatch + thin red ring) and all subsequent in-window days render cold/disabled-looking (the run is dead). SUSTAINED (day >30): all 30 hexes complete, plus a counter line `SUSTAINED · DAY 43` under the billet — the hive stays 30, the number keeps climbing.
- Tapping any non-future hex opens the day editor.
- Legend bar (OFFLINE → AUGMENTED ramp).
- Ghost action: `ABORT PROTOCOL` (active) / `ARCHIVE PROTOCOL` (failed or sustained — removes it from the 30 Days view but it stays in `protocols[]` history forever). Both confirm. A new protocol can then be initiated; **only one protocol may be active at a time** (start date within last 30 days and not archived... see §7 for exact definition).

### 6.3 CALENDAR

- Month grid, Monday-first, prev/next month nav (no lower bound but render `pre` cells before `earliest` as inert outlines; upper bound: current month).
- Each committed day: heat color by core ratio; 0% = miss red; today ringed.
- **Protocol markers, permanent:** any day inside ANY protocol window (from `protocols[]` history) gets a small corner hex: **gold** for windows that ended SUSTAINED/completed, **red** for FAILED windows, gold for the in-progress one. Legend line below the grid.
- Tap any committed day → day editor (backfill). Future days inert.

### 6.4 LOADOUT (full-screen)

- Groups as chamfered boxes: name input (inline edit), delete-group (confirm; warns past check-offs of its tasks stop counting), **reorder arrows (▲▼) on groups**.
- Task rows: tier cycle button (CORE → BONUS → PASSIVE → CORE; distinct styles: gold-filled / gold-outline / grey-outline), label input, **reorder arrows (▲▼)**, delete (confirm-less, but a toast with the removed name).
- `+ ADD TASK` per group (focus+select the new input), `+ ADD GROUP` at bottom.
- `RESTORE STANDARD LOADOUT` button (see §5).
- All edits persist immediately. BACK returns to previous view and re-renders.

### 6.5 SYSTEM (full-screen)

Rows: Daily rollover (hour input), UI sounds (hex toggle), Reduce FX (hex toggle, also auto-on via `prefers-reduced-motion`), Edit loadout (link), Initiate/Abort protocol (contextual), Export backup (JSON download `30-days-of-dahl-backup-YYYY-MM-DD.json`), Import backup (file picker + validation), Wipe all data (double confirm; keeps loadout, erases log + protocols).

---

## 7. Protocol & streak logic (exact)

- **Streak** = consecutive days at 100% core, counting backward from today (today included only if already 100%), bounded by `earliest`. Strict: no rest days, no grace, passives/bonus irrelevant.
- **Protocol status — always derived, never stored** (past days are editable; a backfill must be able to un-fail a run):
  - Let `idx` = effective today − start (0-based). Committed days are `0 … min(idx−1, 29)`; today (`idx`, if ≤29) is in progress.
  - **FAILED** if any committed in-window day has core ratio < 1.
  - **SUSTAINED** if `idx ≥ 30` and all 30 days were 100%. Day counter continues: `DAY (idx+1) · SUSTAINED`. Note: a SUSTAINED protocol does NOT re-fail if a day after day 30 is missed — the 30 were banked; the streak number simply resets. (The protocol ended in victory; life continues.)
  - **ACTIVE** otherwise.
- **Active protocol** (for "only one at a time") = the newest entry in `protocols[]` not marked `archived: true` and not superseded. Add `archived` flag to the protocol object; ABORT sets `archived` (an aborted, incomplete run renders on the calendar as red-marked, same as failed — quitting is failing).
- Editing a day inside a failed window recomputes status live; the 30 Days view must reflect an un-fail immediately.

---

## 8. Design tokens

```css
--void:#0b0a08;  --carbon:#12100c;  --carbon-2:#1a1712;
--hair:#2e2a20;  --hair-2:#4a4230;
--gold:#f0b354;  --gold-hi:#ffe9b8; --gold-lo:#8a5a1a;
--fg:#ece5d3;    --dim:#9a8f77;     --faint:#5a5340;
--miss:#2c120e;  --miss-line:#6b2a20;
--disp:"Rajdhani",...;  --tech:"Chakra Petch",...;
--tap:46px;
```

Chamfers via `clip-path` (8–16px cuts). Hatched slant strips (`repeating-linear-gradient 135°`) on pill left edges. Thin gold hairline under the header with the triangular notch at 34%. All numerals `font-variant-numeric: tabular-nums`.

### Background composition (replaces v3's uniform lattice)

Three fixed layers, each its own element (they are the parallax planes, §9):

1. **Light shaft:** the diagonal amber gradient wash + radial top glow (v3's) — deepest layer.
2. **Hex lattice:** proper offset tessellation, but **confined to the upper ~35% of the viewport and fading out** (mask-image), opacity ≤ .04 — middle layer.
3. **Shard clusters:** 2–3 asymmetric gold triangle clusters (one dense in the top-right breaking into small drifting fragments, one sparse lower-left), total opacity ≤ .14 — nearest layer. Asymmetry is the point; do not tile.

Plus static scanlines (1px repeating gradient, opacity ~.012) over everything.

---

## 9. Motion & FX (all behind `fx` toggle + `prefers-reduced-motion`)

- **Boot sequence** (once per session, ~600ms, tap to skip): gold rule draws left→right → gauge frame snaps in → bar fills to current charge with ticks lighting sequentially → title decodes.
- **Decode text:** view titles only; chars scramble into place over ~300ms. Once per view entry.
- **Check moment:** triangle fills with a radial glow burst; the bar's newly-lit segment gets a leading-edge flash; `navigator.vibrate(10)` where supported. This is the dopamine loop — polish it hardest.
- **100% core:** shimmer sweep across the bar + AUGMENTED decodes in + arpeggio (§10). OVERCLOCKED: slow 2s pulse on lit cells.
- **Passive triangle:** when the last passive checks, it flips grey→gold with a single flash (no sound — passives are silent by nature; visual only).
- **Billet cascade:** hexes populate in sequence (~25ms stagger) on entering 30 Days.
- **View transitions:** 1-frame hologram flicker (opacity dip + 1px x-offset) on tab switch; full-screen views (Loadout/System) slide-snap in from the right with the same flicker.
- **Ambient:** light shaft drifts on a 60s loop; occasionally (every 30–90s) ONE small shard detaches and floats 20px before fading. One element, never a particle system.
- **Gyro parallax:** the three background layers translate at different depths (shaft ±2px, lattice ±4px, shards ±6px max) from `DeviceOrientationEvent` beta/gamma, rAF-throttled, `transform: translate3d` only, heavy easing (lerp ~0.06) so it floats rather than jitters. **iOS:** requires `DeviceOrientationEvent.requestPermission()` from a user gesture — request it on the first tap anywhere (silently skip if denied/unavailable). **Desktop fallback:** pointer-position parallax. Fully disabled by Reduce FX / reduced-motion.

---

## 10. Sound (sound.js, all synthesized, no assets)

Lazy-init AudioContext on first gesture. Triangle-wave envelopes, volumes ≤ .12:

- `check`: 880→1318Hz two-blip rise (~130ms)
- `uncheck`: 392Hz single low (~90ms)
- `full` (100% core / protocol initiate): 659–880–1318 ascending arpeggio (~400ms)
- `nav`: 523Hz 50ms tick · `ui`: 740Hz 50ms
- Silent when `sound:false`. Toggling sound ON plays `check` as confirmation; toggling OFF is silent.

---

## 11. PWA & data safety

- `manifest.webmanifest`: name "30 Days of Dahl", short_name "30 Days", standalone, portrait, theme/background `#0b0a08`, icons 192/512 + maskable. Icon: gold hexagon containing the ▲ on void black.
- `sw.js`: versioned cache-first for the shell (html/css/js/fonts/icons), `skipWaiting` + `clients.claim`, cache name bump = update strategy. No runtime caching of anything else (there is nothing else).
- `navigator.storage.persist()` on first run.
- **Backup nudge:** if `lastBackupNudge` ≥ 14 days ago AND the log has ≥ 7 entries, show a one-line toast ("14 days since last backup — export from System") once per session; update `lastBackupNudge` on export.

---

## 12. Explicitly OUT of scope (v1)

Notes/journal (owner's words: "notes are for excuses"), notifications/reminders, weekly/graph stats, multiple simultaneous protocols, cloud sync, themes/light mode, localization, accounts. Do not add.

---

## 13. // VERIFY checklist (owner tests on device; keep these comments in code at the relevant sites)

```
// VERIFY: rollover — at 04:59 local the app shows yesterday; at 05:00 it flips and yesterday is committed
// VERIFY: checking the last core task fires arpeggio + AUGMENTED decode; unchecking reverts state
// VERIFY: bonus cells light independently of the bar; passive triangle goes gold ONLY when all passives checked
// VERIFY: streak counts strictly (backfill a 9/10 day → streak breaks through it)
// VERIFY: failing any day inside an active protocol shows FAILED; backfilling it to 100% un-fails live
// VERIFY: day 31 of a clean protocol shows SUSTAINED with counter rising; a miss after day 30 resets streak but protocol stays SUSTAINED
// VERIFY: abort = red-marked window on calendar, permanent; archive removes from 30 Days view only
// VERIFY: calendar keeps gold/red hex markers for ALL past protocol windows across months
// VERIFY: loadout reorder (groups + tasks) persists and reorders Today immediately
// VERIFY: restore standard re-adds deleted std_* tasks, keeps custom tasks, no duplicates
// VERIFY: export → wipe → import round-trips identical state
// VERIFY: offline — airplane mode after first load, app fully works, fonts render
// VERIFY: install to Android home screen from kiande.com over HTTPS; standalone, no browser chrome
// VERIFY: gyro parallax on Android; iOS permission prompt on first tap; Reduce FX kills all motion
// VERIFY: prefers-reduced-motion disables boot/decode/parallax automatically
// VERIFY: backup nudge appears after 14 days, clears on export
```

---

## 14. Build order (suggested)

1. Shell + tokens + fonts + three tab views with static markup (match mockup).
2. `storage.js` + `model.js` with tests-by-hand in console (streak, protocol derivation, rollover).
3. Today view live (tiers, gauge, cells, triangle checks) + sound.
4. 30 Days (derivation states, billet) + Calendar (history markers).
5. Loadout + System full-screen views (reorder, restore standard, backup).
6. PWA layer (manifest, sw, icons, persistence, nudge).
7. FX pass last (boot, decode, cascade, parallax) — the app must be fully functional with `fx:false`.
