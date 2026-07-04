# Sound inventory — Protocol (kiande.com)

Files live in `_site/sounds/` and are wired in `_site/sound.js` (the `SFX`
map at the top). Every event either plays a random file from its pool, or
falls back to the original synthesized blip when the pool is empty ("synth"
below), or stays silent. To swap a sound: drop the file in `_site/sounds/`,
add its filename to the pool in `sound.js`, and add it to the `SHELL` list
in `sw.js` (then bump `CACHE`) so it works offline.

Sample volume is `SAMPLE_VOLUME` in `sound.js` (currently 0.7).

## Events with files (working now)

| Event | Trigger | File(s) |
|---|---|---|
| `check` | checking any task | random pick of the 14 `dude_*` files (all except aahthatsthestuff) |
| `uncheck` | unchecking a task | `oh-good-bale.mp3` |
| `section` | every task in a group done | `dude_aahthatsthestuff.mp3` |
| `allcore` | 100% core — AUGMENTED | `serious-sam-extra-life.mp3` |

Only one sample plays per tap. Priority when several trigger at once:
**all-core → section complete → all-passive → all-bonus → plain check.**

## Events waiting for a file (currently silent — find replacements)

| Event | Trigger | Current behavior |
|---|---|---|
| `allpassive` | last passive rule checked (triangle flips gold) | silent (spec originally wanted passives silent — your call) |
| `allbonus` | every bonus task checked — OVERCLOCKED | silent |
| `fail` | protocol status flips to FAILED | not wired yet — needs a file AND a trigger decision (play when the failing day commits? when you first open the app after?) |

## Events on synth blips (could take files too)

| Event | Trigger | Current behavior |
|---|---|---|
| `initiate` | protocol initiated / start over | synth ascending arpeggio (659–880–1318 Hz) |
| `nav` | switching tabs | synth 523 Hz tick |
| `ui` | opening menus, confirms, misc buttons | synth 740 Hz tick |
| sound toggle ON | confirmation in System | plays the `check` event |

## Ideas for more moments (nothing wired)

- Streak milestones (day 7 / 14 / 21 in a protocol)
- SUSTAINED reached (day 30 completes — bigger than allcore?)
- Backup exported
- Wipe confirmed (something ominous)
