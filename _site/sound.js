/* ============================================================
   sound.js — Web Audio synth blips (SPEC §10). All synthesized,
   no assets. Triangle-wave envelopes, volumes ≤ .12.
   ============================================================ */

let enabled = true;
let ctx = null;

export function setEnabled(on){ enabled = !!on; }

/* Lazy-init AudioContext on first gesture — browsers refuse to start
   audio before the user has interacted with the page anyway. */
function ac(){
	if (!ctx){
		try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
		catch (e){ return null; }
	}
	if (ctx.state === "suspended") ctx.resume();
	return ctx;
}

function tone(c, freq, t0, dur, vol){
	const o = c.createOscillator(), g = c.createGain();
	o.type = "triangle";
	o.frequency.setValueAtTime(freq, t0);
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	o.connect(g); g.connect(c.destination);
	o.start(t0); o.stop(t0 + dur + 0.02);
}

/* check   880→1318Hz two-blip rise (~130ms)
   uncheck 392Hz single low (~90ms)
   full    659–880–1318 ascending arpeggio (~400ms) — 100% core / protocol initiate
   nav     523Hz 50ms tick
   ui      740Hz 50ms */
export function blip(kind){
	if (!enabled) return;
	const c = ac();
	if (!c) return;
	const t = c.currentTime;
	switch (kind){
		case "check":   tone(c, 880, t, 0.07, 0.12); tone(c, 1318, t + 0.06, 0.09, 0.10); break;
		case "uncheck": tone(c, 392, t, 0.09, 0.10); break;
		case "full":    tone(c, 659, t, 0.09, 0.11); tone(c, 880, t + 0.09, 0.09, 0.11); tone(c, 1318, t + 0.18, 0.22, 0.12); break;
		case "nav":     tone(c, 523, t, 0.05, 0.07); break;
		case "ui":      tone(c, 740, t, 0.05, 0.06); break;
	}
}
