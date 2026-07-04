/* ============================================================
   fx.js — animations (SPEC §9): boot sequence, decode text,
   check moment, billet cascade, view transitions, ambient shard,
   gyro/pointer parallax. Everything here is decoration: the app
   is fully functional with FX off, and every entry point returns
   immediately when disabled.
   ============================================================ */

let enabled = true;

export function prefersReduced(){
	return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Master switch: app.js passes state.fx && !prefersReduced().
   Turning FX off mid-session also tears down parallax + ambient. */
// VERIFY: prefers-reduced-motion disables boot/decode/parallax automatically
export function setEnabled(on){
	enabled = !!on;
	if (!enabled){
		stopParallax();
		stopAmbient();
	} else {
		startParallax();
		startAmbient();
	}
}
export function isEnabled(){ return enabled; }

/* ---------- decode text (SPEC §9) ----------
   View titles only; chars scramble into place over ~300ms. */
const GLYPHS = "!<>-_\\/[]{}—=+*^?#";
const decodeTimers = new WeakMap();
export function decode(el, finalText){
	const text = finalText !== undefined ? finalText : el.textContent;
	if (decodeTimers.has(el)) clearInterval(decodeTimers.get(el));
	if (!enabled){ el.textContent = text; return; }
	const frames = 9, step = 33; /* ≈ 300ms */
	let frame = 0;
	const timer = setInterval(() => {
		frame++;
		if (frame >= frames){
			clearInterval(timer);
			decodeTimers.delete(el);
			el.textContent = text;
			return;
		}
		const reveal = Math.floor(text.length * (frame / frames));
		let out = text.slice(0, reveal);
		for (let i = reveal; i < text.length; i++){
			out += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
		}
		el.textContent = out;
	}, step);
	decodeTimers.set(el, timer);
}

/* ---------- boot sequence (SPEC §9) ----------
   Once per session, ~600ms, tap to skip: gold rule draws left→right →
   gauge frame snaps in → bar fills to current charge → title decodes.
   hooks.fillBar() renders the real bar width; hooks.title is the brand <b>. */
export function runBoot(hooks){
	const overlay = document.getElementById("boot");
	const body = document.body;
	const finish = () => {
		body.classList.remove("boot-pre", "boot-s1", "boot-s2");
		if (overlay) overlay.hidden = true;
		hooks.fillBar();
	};
	if (!enabled){ finish(); return; }

	body.classList.add("boot-pre");
	let done = false;
	const skip = () => { if (!done){ done = true; finish(); } };
	if (overlay){
		overlay.hidden = false;
		overlay.addEventListener("pointerdown", skip, { once: true });
	}

	const t1 = setTimeout(() => body.classList.add("boot-s1"), 30);           /* rule draws */
	const t2 = setTimeout(() => body.classList.add("boot-s2"), 330);          /* gauge snaps in */
	const t3 = setTimeout(() => { if (!done) hooks.fillBar(); }, 500);        /* bar fills, ticks light */
	const t4 = setTimeout(() => { if (hooks.title) decode(hooks.title); }, 380);
	const t5 = setTimeout(() => { if (!done){ done = true;
		body.classList.remove("boot-pre", "boot-s1", "boot-s2");
		if (overlay) overlay.hidden = true;
	} }, 1150);
	/* a skip mid-way leaves timers running but `done` makes them no-ops */
	if (overlay) overlay.addEventListener("pointerdown", () => [t1, t2, t3, t4, t5].forEach(clearTimeout), { once: true });
}

/* ---------- check moment (SPEC §9) ----------
   The dopamine loop — polish it hardest: triangle burst + leading-edge
   flash on the bar + a 10ms haptic tick where supported. */
export function checkMoment(markEl, moltenEl){
	try { if (navigator.vibrate) navigator.vibrate(10); } catch (e){ /* blocked */ }
	if (!enabled) return;
	if (markEl){
		markEl.classList.remove("burst");
		void markEl.offsetWidth; /* restart the animation */
		markEl.classList.add("burst");
	}
	if (moltenEl){
		moltenEl.classList.remove("flash");
		void moltenEl.offsetWidth;
		moltenEl.classList.add("flash");
	}
}

/* 100% core: shimmer sweep across the bar + AUGMENTED decodes in (§9) */
// VERIFY: checking the last core task fires arpeggio + AUGMENTED decode; unchecking reverts state
export function augmented(crucibleEl, stateEl){
	if (!enabled) return;
	if (crucibleEl){
		let sweep = crucibleEl.querySelector(".sweep");
		if (!sweep){
			sweep = document.createElement("div");
			sweep.className = "sweep";
			crucibleEl.appendChild(sweep);
		}
		sweep.classList.remove("go");
		void sweep.offsetWidth;
		sweep.classList.add("go");
	}
	if (stateEl) decode(stateEl);
}

/* Passive triangle: single flash when the last passive checks —
   no sound, passives are silent by nature (§9). */
export function passiveFlash(ptriEl){
	if (!enabled || !ptriEl) return;
	ptriEl.classList.remove("flash");
	void ptriEl.offsetWidth;
	ptriEl.classList.add("flash");
}

/* Billet cascade: hexes populate in sequence, ~25ms stagger (§9) */
export function cascade(hiveEl){
	if (!enabled || !hiveEl) return;
	const hexes = hiveEl.querySelectorAll(".hex");
	hexes.forEach((h, i) => { h.style.animationDelay = (i * 25) + "ms"; });
	hiveEl.classList.add("cascade");
	setTimeout(() => {
		hiveEl.classList.remove("cascade");
		hexes.forEach(h => { h.style.animationDelay = ""; });
	}, hexes.length * 25 + 400);
}

/* View transitions (§9): 1-frame hologram flicker on tab switch;
   full-screen views slide-snap in from the right. */
export function tabFlicker(el){
	if (!enabled || !el) return;
	el.classList.remove("flick");
	void el.offsetWidth;
	el.classList.add("flick");
	setTimeout(() => el.classList.remove("flick"), 180);
}
export function fullSlide(el){
	if (!enabled || !el) return;
	el.classList.remove("slidein");
	void el.offsetWidth;
	el.classList.add("slidein");
	setTimeout(() => el.classList.remove("slidein"), 260);
}

/* ---------- ambient (SPEC §9) ----------
   Every 30–90s ONE small shard detaches and floats 20px before fading.
   One element, never a particle system. (The light-shaft 60s drift is
   pure CSS on .bg-shaft.) */
let ambientTimer = null;
function scheduleShard(){
	ambientTimer = setTimeout(() => {
		const shard = document.querySelector(".shard-drifter");
		if (shard && enabled && !document.hidden){
			shard.classList.add("detach");
			setTimeout(() => shard.classList.remove("detach"), 3400);
		}
		scheduleShard();
	}, 30000 + Math.random() * 60000);
}
function startAmbient(){
	if (!ambientTimer) scheduleShard();
}
function stopAmbient(){
	clearTimeout(ambientTimer);
	ambientTimer = null;
}

/* ---------- parallax (SPEC §9) ----------
   The three background layers translate at different depths from
   DeviceOrientationEvent beta/gamma (shaft ±2px, lattice ±4px,
   shards ±6px), rAF-throttled, translate3d only, heavy easing
   (lerp ≈ .06) so it floats rather than jitters.
   Desktop fallback: pointer-position parallax. */
// VERIFY: gyro parallax on Android; iOS permission prompt on first tap; Reduce FX kills all motion
const DEPTHS = [2, 4, 6]; /* shaft, lattice, shards */
let rafId = null;
let target = { x: 0, y: 0 };   /* −1 … 1 */
let pos = { x: 0, y: 0 };
let layers = null;
let listening = false;

function layerEls(){
	if (!layers){
		layers = [
			document.querySelector(".bg-shaft"),
			document.querySelector(".bg-lattice"),
			document.querySelector(".bg-shards"),
		];
	}
	return layers;
}

function onOrientation(e){
	if (e.beta === null || e.gamma === null) return;
	/* gamma: left/right tilt (±90) → x · beta: front/back (±180) → y,
	   centered on a comfortable ~40° holding angle */
	target.x = Math.max(-1, Math.min(1, e.gamma / 30));
	target.y = Math.max(-1, Math.min(1, (e.beta - 40) / 30));
}
function onPointer(e){
	target.x = (e.clientX / window.innerWidth) * 2 - 1;
	target.y = (e.clientY / window.innerHeight) * 2 - 1;
}

function loop(){
	pos.x += (target.x - pos.x) * 0.06;
	pos.y += (target.y - pos.y) * 0.06;
	layerEls().forEach((el, i) => {
		if (el) el.style.transform = `translate3d(${(pos.x * DEPTHS[i]).toFixed(2)}px, ${(pos.y * DEPTHS[i]).toFixed(2)}px, 0)`;
	});
	rafId = requestAnimationFrame(loop);
}

function startParallax(){
	if (rafId !== null) return;
	if (!listening){
		listening = true;
		window.addEventListener("deviceorientation", onOrientation);
		window.addEventListener("pointermove", onPointer);
		/* iOS requires an explicit permission request from a user gesture:
		   ask on the first tap anywhere, silently skip if denied/unavailable. */
		if (typeof DeviceOrientationEvent !== "undefined" &&
			typeof DeviceOrientationEvent.requestPermission === "function"){
			document.addEventListener("pointerdown", function askOnce(){
				document.removeEventListener("pointerdown", askOnce);
				DeviceOrientationEvent.requestPermission().catch(() => { /* denied — pointer fallback stays */ });
			}, { once: true });
		}
	}
	rafId = requestAnimationFrame(loop);
}
function stopParallax(){
	if (rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
	layerEls().forEach(el => { if (el) el.style.transform = ""; });
	pos = { x: 0, y: 0 };
	target = { x: 0, y: 0 };
}
