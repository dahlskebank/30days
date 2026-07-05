/* ============================================================
   sound.js — check-off soundboard + Web Audio synth fallback.

   ONE VOICE CHANNEL: samples never stack. Two modes, switchable
   in System → "Smart burst" (state.soundMode):

     "smart"     (C, default) — a new sample interrupts the current
                 one, EXCEPT during a rapid burst: taps landing
                 within BURST_MS of the last started quote fall back
                 to the short synth blip so machine-gun checking
                 ticks instead of stuttering quotes. Milestone
                 events (section / all-core / initiate) are marked
                 `important` and always interrupt.

     "interrupt" (A) — every event stops the current sample and
                 plays its own. Simple, always talks, can stutter.

   Named events map to sample pools in /sounds (random pick when a
   pool has several files). Pools can be empty — the event then
   falls back to a synthesized blip, or stays silent when the
   fallback is null. Inventory + empty slots: SOUNDS.md at the
   project root.
   ============================================================ */

let enabled = true;
let mode = "smart"; /* "smart" (C) | "interrupt" (A) */
let ctx = null;

/* the single voice channel */
let current = null;
let lastStart = 0;
const BURST_MS = 600;
const SAMPLE_VOLUME = 0.7;

export function setEnabled(on) {
	enabled = !!on;
}
export function setMode(m) {
	mode = m === "interrupt" ? "interrupt" : "smart";
}

/* ---------- sample pools ---------- */
const DUDE_CHECKS = [
	"dude_hehhehheh.mp3",
	"dude_idefinitelyneed.mp3",
	"dude_ididntexpectthat.mp3",
	"dude_idontthinkso.mp3",
	"dude_ifeelbetter.mp3",
	"dude_igottafindmore.mp3",
	"dude_iknewit.mp3",
	"dude_iknewit2.mp3",
	"dude_map_found3.mp3",
	"dude_nowtheflowers.mp3",
	"dude_thatcantbegood.wav",
	"dude_thatmustbetheone.mp3",
	"dude_thatsclearly.mp3",
	"dude_yess.mp3",
];

/* event → { pool, fallback synth kind (null = silent when pool empty),
   important: milestone sounds that always interrupt, never burst-tick } */
const SFX = {
	check: { pool: DUDE_CHECKS, fallback: "check" },
	uncheck: { pool: ["oh-good-bale.mp3"], fallback: "uncheck" },
	section: { pool: ["dude_aahthatsthestuff.mp3"], fallback: "check", important: true },
	allcore: { pool: ["serious-sam-extra-life.mp3"], fallback: "full", important: true },
	allbonus: { pool: [], fallback: null }, /* OVERCLOCKED — no file yet */
	allpassive: { pool: [], fallback: null }, /* all passive rules online — no file yet */
	initiate: { pool: [], fallback: "full", important: true }, /* protocol initiated */
	fail: { pool: [], fallback: null }, /* protocol failed — no file yet */
	nav: { pool: [], fallback: "nav" },
	ui: { pool: [], fallback: "ui" },
};

/* Play through the single channel. Returns false when the burst rule
   suppressed the sample — the caller then plays the synth fallback. */
function playSample(pool, important) {
	const now = performance.now();
	const busy = current && !current.paused && !current.ended;
	if (!important && mode === "smart" && busy && now - lastStart < BURST_MS) {
		return false;
	}
	if (busy) current.pause(); /* one voice: interrupt whatever is talking */
	const file = pool[(Math.random() * pool.length) | 0];
	try {
		const a = new Audio("/sounds/" + file);
		a.volume = SAMPLE_VOLUME;
		current = a;
		lastStart = now;
		a.play().catch(() => {
			/* pre-gesture autoplay block — ignore */
		});
		return true;
	} catch (e) {
		return false;
	}
}

/* ---------- synth fallback (the original SPEC §10 blips) ---------- */
function ac() {
	if (!ctx) {
		try {
			ctx = new (window.AudioContext || window.webkitAudioContext)();
		} catch (e) {
			return null;
		}
	}
	if (ctx.state === "suspended") ctx.resume();
	return ctx;
}

function tone(c, freq, t0, dur, vol) {
	const o = c.createOscillator(),
		g = c.createGain();
	o.type = "triangle";
	o.frequency.setValueAtTime(freq, t0);
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	o.connect(g);
	g.connect(c.destination);
	o.start(t0);
	o.stop(t0 + dur + 0.02);
}

function synth(kind) {
	const c = ac();
	if (!c) return;
	const t = c.currentTime;
	switch (kind) {
		case "check":
			tone(c, 880, t, 0.07, 0.12);
			tone(c, 1318, t + 0.06, 0.09, 0.1);
			break;
		case "uncheck":
			tone(c, 392, t, 0.09, 0.1);
			break;
		case "full":
			tone(c, 659, t, 0.09, 0.11);
			tone(c, 880, t + 0.09, 0.09, 0.11);
			tone(c, 1318, t + 0.18, 0.22, 0.12);
			break;
		case "nav":
			tone(c, 523, t, 0.05, 0.07);
			break;
		case "ui":
			tone(c, 740, t, 0.05, 0.06);
			break;
	}
}

/* ---------- public API ---------- */
export function blip(kind) {
	if (!enabled) return;
	const sfx = SFX[kind];
	if (!sfx) {
		synth(kind); /* raw synth kinds still work */
		return;
	}
	if (sfx.pool.length && playSample(sfx.pool, sfx.important)) return;
	if (sfx.fallback) synth(sfx.fallback);
}
