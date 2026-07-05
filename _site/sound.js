/* ============================================================
   sound.js — check-off soundboard + Web Audio synth fallback.

   FILE NAMING CONVENTION (owner's): every file in /sounds is
   prefixed with the event it belongs to (check_, uncheck_,
   allcore_, …). Files starting with "_" are unused/benched.
   Add a file → drop it in /sounds with the right prefix, add it
   to the pool below AND to the SOUNDS list in sw.js, bump CACHE.

   ONE VOICE CHANNEL: samples never stack. Two modes, switchable
   in System → "Smart burst" (state.soundMode):

     "interrupt" (A, default) — every event stops the current
                 sample and plays its own.
     "smart"     (C) — same, except taps landing within BURST_MS
                 of the last started quote fall back to the short
                 synth blip (machine-gun checking ticks instead of
                 stuttering quotes). `important` events always talk.
   ============================================================ */

let enabled = true;
let mode = "interrupt"; /* "interrupt" (A) | "smart" (C) */
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
	mode = m === "smart" ? "smart" : "interrupt";
}

/* event → { pool, fallback synth kind (null = silent when pool empty),
   important: milestone sounds that always interrupt, never burst-tick } */
const SFX = {
	check: {
		pool: [
			"check_dude_hehhehheh.mp3",
			"check_dude_idefinitelyneed.mp3",
			"check_dude_ididntexpectthat.mp3",
			"check_dude_igottafindmore.mp3",
			"check_dude_map_found3.mp3",
			"check_dude_thatmustbetheone.mp3",
			"check_dude_yess.mp3",
		],
		fallback: "check",
	},
	uncheck: {
		pool: [
			"uncheck_dk_FX108_chicken.mp3",
			"uncheck_dk_FX109_chicken.mp3",
			"uncheck_dk_FX194_bwaff.mp3",
			"uncheck_dk_FX242_femscream.mp3",
			"uncheck_dk_FX243_femscream.mp3",
			"uncheck_dk_FX244_femscream.mp3",
			"uncheck_dk_FX250_femscream.mp3",
			"uncheck_dude_thatcantbegood.wav",
			"uncheck_dude_thatsclearly.mp3",
		],
		fallback: "uncheck",
	},
	alldone: { pool: [], fallback: "fanfare", important: true }, /* EVERY task in every tier — drop an alldone_* file in /sounds */
	section: { pool: ["section_dude_aahthatsthestuff.mp3"], fallback: "check", important: true },
	allcore: { pool: ["allcore_serious-sam-extra-life.mp3"], fallback: "full", important: true },
	allbonus: { pool: ["allbonus_dude_ifeelbetter.mp3"], fallback: null, important: true },
	allpassive: { pool: ["allpassive_check_dude_nowtheflowers.mp3"], fallback: null, important: true },
	initiate: { pool: ["initiate_dk_FX93_pants.mp3"], fallback: "full", important: true },
	soundtoggle: { pool: ["sound_toggle_FX154.mp3"], fallback: "check", important: true },
	wipe: { pool: ["wipe_oh-good-bale.mp3"], fallback: null, important: true },
	fail: { pool: [], fallback: null }, /* protocol failed — no file yet */
	delete: { pool: [], fallback: "delete" }, /* removing a task/group — synth zap */
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

/* downward frequency zap — reads as "removed / powered down" */
function zap(c, from, to, t0, dur, vol) {
	const o = c.createOscillator(),
		g = c.createGain();
	o.type = "triangle";
	o.frequency.setValueAtTime(from, t0);
	o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
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
		case "fanfare":
			/* the perfect-day stinger (synth placeholder until a file lands):
			   rising five-note run capped with a sustained high octave */
			tone(c, 523, t, 0.09, 0.1);
			tone(c, 659, t + 0.09, 0.09, 0.1);
			tone(c, 784, t + 0.18, 0.09, 0.11);
			tone(c, 1047, t + 0.27, 0.1, 0.11);
			tone(c, 1568, t + 0.38, 0.34, 0.12);
			tone(c, 784, t + 0.38, 0.34, 0.06); /* octave under the top note — fuller finish */
			break;
		case "delete":
			/* falling zap + a low thud at the bottom — something got shredded */
			zap(c, 620, 140, t, 0.16, 0.1);
			tone(c, 110, t + 0.13, 0.09, 0.08);
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
