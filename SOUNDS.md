# Sound inventory — Protocol (kiande.com)

Files live in `_site/sounds/` and are wired in `_site/sound.js` (the `SFX`
map). **Naming convention: the filename prefix = the event it plays on**
(`check_`, `uncheck_`, `allcore_`, …). Files starting with `_` are benched /
unused. To add or swap a sound: drop it in `_site/sounds/` with the right
prefix, add the filename to the matching pool in `sound.js`, add it to the
`SOUNDS` list in `sw.js`, bump `CACHE`.

One voice channel — samples never stack. Two modes via System → Smart
burst: OFF (default) = every event interrupts with a fresh sample; ON =
rapid taps within 600ms fall back to synth blips, milestones always talk.
Sample volume: `SAMPLE_VOLUME` in sound.js (0.7).

## Wired events

| Event | Trigger | Pool |
|---|---|---|
| `check` | checking any task (core/bonus/passive alike) | 7 × `check_dude_*` |
| `uncheck` | unchecking a task | 9 × `uncheck_*` (chickens, bwaff, screams, Dude) |
| `section` | every task in a group done | `section_dude_aahthatsthestuff` |
| `allcore` | 100% core — AUGMENTED | `allcore_serious-sam-extra-life` |
| `allbonus` | every bonus task checked — OVERCLOCKED | `allbonus_dude_ifeelbetter` |
| `allpassive` | last passive rule checked | `allpassive_check_dude_nowtheflowers` |
| `initiate` | protocol initiated / start over | `initiate_dk_FX93_pants` |
| `soundtoggle` | Sounds switch flipped (both directions) | `sound_toggle_FX154` |
| `wipe` | wipe all data · reset protocol (testing) | `wipe_oh-good-bale` |
| `delete` | deleting a task or group in Loadout | synth "falling zap + thud" |
| `nav` / `ui` | tab switch / generic buttons | synth ticks (kept per owner) |

Priority per tap: **all-core → section → all-passive → all-bonus → check.**

## Benched (unused, kept in the folder)

- `_dude_iknewit.mp3`, `_dude_iknewit2.mp3` — candidate: the `fail` event
  (protocol just died — "I knew it" is grimly perfect)
- `_dude_idontthinkso.mp3` — candidate: Cancel in a confirm dialog, or a
  future "tap on a disabled/future day" denial sound

## Empty slots

| Event | Trigger | Current behavior |
|---|---|---|
| `fail` | protocol status flips to FAILED | not wired — needs a file AND a trigger decision (when the failing day commits? on next app open?) |
