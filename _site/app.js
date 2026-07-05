/* ============================================================
   app.js — entry point: init, tab track (swipe + tap), panel
   orchestration, rendering, events. Rendering stays deliberately
   dumb: every interaction mutates state, saves, and re-renders
   the three tab screens from scratch — at this app's size that is
   instant, and it makes un-fail / rollover / reorder correctness
   automatic.

   Shell layout: .app is a fixed-height column (topbar + rule +
   swipeable .viewport + nav). The three tab screens sit side by
   side in .track and slide as one strip. SYSTEM is an offcanvas
   drawer from the left; LOADOUT is a bottom sheet; the day editor
   and confirm dialogs are HUD overlays.
   ============================================================ */

import * as storage from "./storage.js";
import {
	PROT_LEN, MONTHS, keyOf, dateOf, addDays, diffDays, fmtLong, genId,
	effectiveToday, dayStats, chargeWord, heatColor, currentStreak,
	bestStreakInRange, currentProtocol, protocolStatus, protocolMarker,
	protocolWindow, restoreStandard, tierTasks,
} from "./model.js";
import { blip, setEnabled as setSoundEnabled } from "./sound.js";
import * as fx from "./fx.js";

const APP_VERSION = "v1.1.3";

/* ---------- state ---------- */
let state = storage.load();
const firstRun = !state;
if (firstRun){
	state = storage.seed();
	storage.requestPersist();
}

const TAB_IDS = ["today", "prot", "cal"];
let tabIndex = 0;
let calCursor = null;               /* first-of-month Date the calendar shows */
let editingKey = null;              /* day the editor overlay has open */
let lastRenderedDay = null;
let nudgeShown = false;
let deferredInstall = null;         /* captured beforeinstallprompt event */

/* ---------- tiny DOM helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function todayKey(){ return keyOf(effectiveToday(state.rolloverHour)); }
function fmtShort(d){ return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear(); }

function persist(){
	const ok = storage.save(state);
	if (!ok) toast("Could not save — storage full or blocked");
	return ok;
}

function applySettings(){
	setSoundEnabled(state.sound);
	fx.setEnabled(state.fx && !fx.prefersReduced());
	document.body.classList.toggle("marks-right", !!state.marksRight);
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg){
	const t = $("toast");
	t.textContent = msg;
	t.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- confirm HUD (promise-based, replaces window.confirm) ---------- */
let confirmResolve = null;
function confirmHud(title, msg, { danger = false, yes = "Confirm" } = {}){
	return new Promise(resolve => {
		confirmResolve = resolve;
		$("chTitle").textContent = title;
		$("chMsg").textContent = msg;
		$("chYes").textContent = yes;
		const hud = $("confirmHud");
		hud.classList.toggle("danger", danger);
		/* a confirm must be modal even over the System drawer / Loadout
		   sheet (z 11): .raised lifts the scrim to z 12, under the confirm (13) */
		$("scrim").classList.add("raised");
		openOverlay(hud);
	});
}
function settleConfirm(answer){
	$("scrim").classList.remove("raised");
	closeOverlay($("confirmHud"));
	if (confirmResolve){ confirmResolve(answer); confirmResolve = null; }
}

/* ---------- overlay open/close (scrim + sliding panels) ---------- */
const hideTimers = new WeakMap();
function openOverlay(el){
	/* cancel a pending hide from a just-closed overlay — without this a
	   reopen within 300ms (e.g. the wipe double-confirm) gets force-hidden */
	clearTimeout(hideTimers.get(el));
	$("scrim").classList.add("open");
	if (!el.hidden){
		/* still visible (mid fade-out): re-open in place, no blink */
		el.classList.add("open");
		return;
	}
	el.hidden = false;
	requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("open")));
}
function closeOverlay(el){
	el.classList.remove("open");
	hideTimers.set(el, setTimeout(() => { el.hidden = true; }, 320));
	if (!anyOverlayOpen()) $("scrim").classList.remove("open");
}
function anyOverlayOpen(){
	return !!document.querySelector(".hud.open, .offcanvas.open");
}
function isOpen(id){ return $(id).classList.contains("open"); }

/* ============================================================
   TAB TRACK — tap a nav pill or swipe horizontally between the
   three screens; both animate the same physical slide.
   ============================================================ */
function applyTrack(){
	$("track").style.transform = `translateX(${-tabIndex * 100}%)`;
	const vp = $("viewport");
	if (vp.scrollLeft) vp.scrollLeft = 0; /* belt-and-braces vs any residual focus-scroll */
}

function showTab(i, { silent = false } = {}){
	const changed = i !== tabIndex;
	tabIndex = i;
	$("track").classList.remove("dragging");
	applyTrack();
	TAB_IDS.forEach((t, k) => {
		$("tab-" + t).setAttribute("aria-selected", k === i);
		/* off-screen tabs leave the tab order and screen-reader flow */
		$("screen-" + t).inert = k !== i;
	});
	if (changed && !silent) blip("nav");
	/* billet cascade on entering 30 Days (SPEC §9) */
	if (changed && TAB_IDS[i] === "prot") renderProt({ entering: true });
}

/* swipe engine: vertical scrolling stays native (touch-action:pan-y on the
   viewport); once a drag is clearly horizontal we capture the pointer and
   drive the track transform directly, then snap on release. */
function initSwipe(){
	const viewport = $("viewport");
	const track = $("track");
	let drag = null;

	/* drop the drag without committing anything — snap back where we were */
	const abortDrag = () => {
		drag = null;
		track.classList.remove("dragging");
		applyTrack();
	};

	viewport.addEventListener("pointerdown", e => {
		/* one drag at a time: a second finger / resting palm must not steal
		   or corrupt a live drag (its events are filtered by pointerId below) */
		if (drag) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		drag = {
			id: e.pointerId,
			startX: e.clientX, startY: e.clientY,
			decided: false, horizontal: false,
			width: viewport.clientWidth,
			lastX: e.clientX, lastT: performance.now(), vel: 0,
		};
	});

	viewport.addEventListener("pointermove", e => {
		if (!drag || e.pointerId !== drag.id) return;
		/* mouse released outside the window: no pointerup ever arrives here,
		   and hover moves would otherwise keep feeding a stale drag */
		if (e.pointerType === "mouse" && e.buttons === 0){ abortDrag(); return; }
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (!drag.decided){
			if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
			drag.decided = true;
			drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
			if (!drag.horizontal){ drag = null; return; } /* let native vertical scroll have it */
			try { viewport.setPointerCapture(drag.id); } catch (err){ /* pointer already gone */ }
			track.classList.add("dragging");
		}
		const now = performance.now();
		drag.vel = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
		drag.lastX = e.clientX;
		drag.lastT = now;

		let offset = -tabIndex * drag.width + dx;
		const min = -(TAB_IDS.length - 1) * drag.width;
		if (offset > 0) offset *= 0.35;                       /* rubber-band past the first tab */
		if (offset < min) offset = min + (offset - min) * 0.35; /* …and past the last */
		track.style.transform = `translateX(${offset}px)`;
	});

	viewport.addEventListener("pointerup", e => {
		if (!drag || e.pointerId !== drag.id) return;
		const d = drag;
		drag = null;
		track.classList.remove("dragging");
		if (!d.decided || !d.horizontal) return; /* transform was never touched */
		const dx = e.clientX - d.startX;
		let target = tabIndex;
		/* flick velocity decides the direction when it triggers the commit —
		   a sharp flick BACK after a small drag must cancel, not advance */
		if (Math.abs(d.vel) > 0.45) target = tabIndex + (d.vel < 0 ? 1 : -1);
		else if (Math.abs(dx) > d.width * 0.22) target = tabIndex + (dx < 0 ? 1 : -1);
		target = Math.max(0, Math.min(TAB_IDS.length - 1, target));
		if (target === tabIndex) applyTrack(); /* snap back */
		else showTab(target);
	});

	/* a cancelled gesture (notification shade, rotation, palm rejection)
	   never commits — platform convention is to snap back */
	viewport.addEventListener("pointercancel", e => {
		if (!drag || e.pointerId !== drag.id) return;
		abortDrag();
	});
}

/* ---------- render orchestration ---------- */
function renderAll(){
	renderToday();
	renderProt();
	renderCal();
}
function refreshOpenPanels(){
	if (isOpen("systemPanel")) renderSystem();
	if (isOpen("loadoutHud")) renderLoadout();
	if (editingKey && isOpen("dayHud")) renderDayHud(editingKey);
}

/* ============================================================
   TODAY (SPEC §6.1)
   ============================================================ */
function renderToday(){
	const key = todayKey();
	const s = dayStats(state, key);

	/* --- day mark: protocol context or FREE RUN --- */
	const prot = currentProtocol(state);
	const mark = $("todayMark");
	if (!prot){
		mark.innerHTML = `FREE <em>RUN</em>`;
	} else {
		const st = protocolStatus(state, prot);
		if (st.status === "FAILED") mark.innerHTML = `PROTOCOL <em class="failed">FAILED</em>`;
		else if (st.status === "SUSTAINED") mark.innerHTML = `DAY ${st.dayNumber} <em>· SUSTAINED</em>`;
		else mark.innerHTML = `DAY ${st.dayNumber} <em>/ ${PROT_LEN}</em>`;
	}
	$("todayDate").textContent = fmtLong(effectiveToday(state.rolloverHour));

	/* --- gauge --- */
	$("gCount").textContent = s.coreDone;
	$("gTotal").textContent = s.coreTotal;
	$("gPct").textContent = "CHARGE " + Math.round(s.ratio * 100) + "%" + (s.ratio >= 1 && s.bonusDone > 0 ? " +" + s.bonusDone : "");
	const stateEl = $("gState");
	fx.cancelDecode(stateEl); /* a mid-scramble AUGMENTED decode must not overwrite a fresh lower state word */
	stateEl.textContent = chargeWord(s);
	stateEl.style.color = (s.ratio > 0 || s.bonusDone > 0) ? heatColor(Math.max(s.ratio, 0.3)) : "var(--faint)";

	updateMolten(false);

	const ticks = $("gTicks");
	if (ticks.childElementCount !== s.coreTotal){
		ticks.innerHTML = "";
		for (let i = 0; i < s.coreTotal; i++) ticks.appendChild(document.createElement("i"));
	}

	/* --- overcharge cells + passive triangle (SPEC §4/§6.1) --- */
	// VERIFY: bonus cells light independently of the bar; passive triangle goes gold ONLY when all passives checked
	const cells = $("gCells");
	cells.innerHTML = "";
	cells.classList.toggle("overclocked", s.ratio >= 1 && s.bonusDone > 0);
	const done = new Set(state.log[key] || []);
	const bonus = tierTasks(state.groups, "bonus");
	if (bonus.length){
		const cap = document.createElement("span");
		cap.className = "cap";
		cap.textContent = "Overcharge";
		cells.appendChild(cap);
		bonus.forEach(t => {
			const c = document.createElement("span");
			c.className = "cell-hex" + (done.has(t.id) ? " lit" : "");
			c.title = t.label;
			cells.appendChild(c);
		});
	}
	if (s.passiveTotal > 0){
		const wrap = document.createElement("span");
		wrap.className = "passive-ind";
		wrap.innerHTML = `<span class="cap">Passive</span><span class="ptri${s.allPassive ? " on" : ""}" id="ptri" title="All passive rules online"></span>`;
		cells.appendChild(wrap);
	}

	/* --- task groups, user order --- */
	const host = $("todayGroups");
	host.innerHTML = "";
	state.groups.forEach(g => host.appendChild(groupEl(g, key, true)));
}

function updateMolten(fromZero){
	const key = todayKey();
	const s = dayStats(state, key);
	const molten = $("gMolten");
	if (fromZero){
		molten.style.transition = "none";
		molten.style.width = "0%";
		void molten.offsetWidth;
		molten.style.transition = "";
	}
	molten.style.width = (s.ratio * 100) + "%";
	molten.style.boxShadow = s.ratio > 0 ? `0 0 ${10 + s.ratio * 22}px rgba(240,179,84,${0.3 + s.ratio * 0.5})` : "none";
}

/* One task-group block; used by Today (live) and the day editor (!live). */
function groupEl(group, key, live){
	const done = new Set(state.log[key] || []);
	const wrap = document.createElement("section");
	wrap.className = "group";

	const head = document.createElement("div");
	head.className = "group-head";
	const n = group.tasks.filter(t => done.has(t.id)).length;
	head.innerHTML = `<span class="name">${esc(group.name)}</span><span class="frac">${n} / ${group.tasks.length}</span>`;
	wrap.appendChild(head);

	group.tasks.forEach(t => {
		const isDone = done.has(t.id);
		const btn = document.createElement("button");
		btn.className = "task";
		btn.dataset.done = isDone;
		btn.dataset.tier = t.tier;
		btn.dataset.taskId = t.id;
		btn.setAttribute("aria-pressed", isDone);
		/* tier tag only for non-core; whole row toggles */
		btn.innerHTML =
			`<span class="mark"></span>` +
			(t.tier !== "core" ? `<span class="tag">${t.tier.toUpperCase()}</span>` : "") +
			`<span class="label">${esc(t.label)}</span>`;
		btn.addEventListener("click", () => onToggleTask(key, t, group, live));
		wrap.appendChild(btn);
	});
	return wrap;
}

/* The check moment (SPEC §9) — sound + burst + bar flash + haptics,
   plus the AUGMENTED / section-complete / passive-online transitions.
   Sound priority per tap: all-core > section complete > all-passive
   > all-bonus > plain check (one sample per tap, never a pile-up). */
function onToggleTask(key, task, group, live){
	const before = dayStats(state, key);

	const arr = (state.log[key] || []).slice();
	const at = arr.indexOf(task.id);
	const nowDone = at < 0;
	if (nowDone) arr.push(task.id); else arr.splice(at, 1);
	state.log[key] = arr;
	persist();

	const after = dayStats(state, key);
	const crossedAllCore = before.ratio < 1 && after.ratio >= 1;
	const crossedAllPassive = !before.allPassive && after.allPassive;
	const crossedAllBonus = after.bonusTotal > 0 && before.bonusDone < before.bonusTotal && after.bonusDone === after.bonusTotal;
	const doneSet = new Set(arr);
	const sectionComplete = nowDone && group.tasks.length > 0 && group.tasks.every(t => doneSet.has(t.id));

	// VERIFY: checking the last core task fires the all-core sound + AUGMENTED decode; unchecking reverts state
	if (!nowDone) blip("uncheck");
	else if (crossedAllCore) blip("allcore");
	else if (sectionComplete) blip("section");
	else if (crossedAllPassive) blip("allpassive");
	else if (crossedAllBonus) blip("allbonus");
	else blip("check");

	/* re-render, then point the FX at the freshly-built nodes */
	if (live) renderToday();
	else renderDayHud(key);
	renderProt(); /* un-fail must show immediately (SPEC §7) */
	renderCal();

	const scope = live ? $("screen-today") : $("dayHud");
	/* CSS.escape: imported backups may carry ids with selector metacharacters */
	const markEl = scope.querySelector(`.task[data-task-id="${CSS.escape(task.id)}"] .mark`);
	/* the bar's leading-edge flash belongs to core checks only — bonus and
	   passive never move the bar (SPEC §4/§9) */
	if (nowDone) fx.checkMoment(markEl, live && task.tier === "core" ? $("gMolten") : null);
	if (live){
		if (crossedAllCore) fx.augmented(document.querySelector("#screen-today .crucible"), $("gState"));
		if (crossedAllPassive) fx.passiveFlash($("ptri"));
	}
}

/* ============================================================
   30 DAYS (SPEC §6.2 — revised: there is no abort. A run only
   ends by FAILING (core streak breaks) or SUSTAINING. After a
   fail you start over — always, constantly.)
   ============================================================ */
function renderProt({ entering = false } = {}){
	const host = $("screen-prot");
	host.innerHTML = "";
	const prot = currentProtocol(state);

	/* --- no active protocol --- */
	if (!prot){
		host.innerHTML = `
			<div class="noprot">
				<div class="hexlogo"><span>30</span></div>
				<h3>No active protocol</h3>
				<p>Commit to a 30-day window. The log runs either way — the protocol is the crucible.</p>
				<button class="cta" id="initBtn"><span class="tri"></span>Initiate protocol</button>
			</div>`;
		$("initBtn").addEventListener("click", initiateProtocol);
		return;
	}

	const st = protocolStatus(state, prot);
	const endD = addDays(st.startD, PROT_LEN - 1);

	/* --- eyebrow + streak block --- */
	let statusWord = "";
	if (st.status === "FAILED") statusWord = ` · <span class="status-failed">FAILED</span>`;
	else if (st.status === "SUSTAINED") statusWord = ` · SUSTAINED`;

	const lastIdx = Math.min(st.idx, PROT_LEN - 1);
	let full = 0, sum = 0, counted = 0;
	for (let i = 0; i <= lastIdx; i++){
		const r = dayStats(state, keyOf(addDays(st.startD, i))).ratio;
		if (r >= 1) full++;
		sum += r; counted++;
	}
	const streak = currentStreak(state);
	const best = bestStreakInRange(state, st.startD, addDays(st.startD, lastIdx));

	const head = document.createElement("div");
	head.innerHTML = `
		<div class="eyebrow"><span class="tri"></span><span>Protocol · ${fmtShort(st.startD)} → ${fmtShort(endD)}${statusWord}</span></div>
		<div class="streak">
			<div class="num ${streak === 0 ? "zero" : ""}">${streak}</div>
			<div class="lbl">Day streak</div>
			<div class="stats">best <b>${best}</b> · augmented <b>${full}</b>/${counted} · avg charge <b>${Math.round((counted ? sum / counted : 0) * 100)}%</b></div>
		</div>`;
	host.appendChild(head);

	/* --- honeycomb billet: 30 hexes, rows 6-5-6-5-6-2, offset --- */
	const hive = document.createElement("div");
	hive.className = "hive";
	const rows = [6, 5, 6, 5, 6, 2];
	let idx = 0;
	rows.forEach(count => {
		const row = document.createElement("div");
		row.className = "hive-row";
		for (let c = 0; c < count; c++){
			const i = idx++;
			const key = keyOf(addDays(st.startD, i));
			const hex = document.createElement("button");
			hex.className = "hex";
			hex.innerHTML = `<span class="dnum">${i + 1}</span>`;

			const isFuture = i > st.idx;
			const isDead = st.failIdx >= 0 && i > st.failIdx; /* the run is dead past the fracture */

			if (isFuture){
				hex.disabled = true;
				hex.classList.add(isDead ? "dead" : "future");
				hex.setAttribute("aria-label", `Day ${i + 1}, not started`);
			} else {
				const ds = dayStats(state, key);
				if (i === st.failIdx){
					/* the breaking day: fracture — heavier hatch + thin red ring */
					hex.classList.add("fract");
					hex.style.background = ds.ratio > 0 ? heatColor(ds.ratio) : "var(--miss)";
				} else if (isDead){
					hex.classList.add("dead");
				} else if (ds.ratio === 0){
					/* 0% CORE is a miss even if bonus/passive were checked —
					   charge is core-only (SPEC §4) and the day breaks streaks */
					hex.classList.add("miss");
				} else {
					hex.style.background = heatColor(ds.ratio);
					if (ds.ratio >= 0.6) hex.classList.add("hot");
					/* OVERCLOCKED days glow stronger — shadow scales with bonus count (SPEC §4) */
					if (ds.ratio >= 1) hex.style.boxShadow = `0 0 ${16 + ds.bonusDone * 6}px rgba(240,179,84,${0.45 + ds.bonusDone * 0.12})`;
				}
				if (i === st.idx && st.status !== "SUSTAINED") hex.classList.add("today");
				hex.setAttribute("aria-label", `Day ${i + 1}, ${Math.round(ds.ratio * 100)} percent. Edit.`);
				/* tapping any non-future hex opens the day editor — including dead
				   ones: a backfill must be able to un-fail the run (SPEC §7) */
				hex.addEventListener("click", () => { blip("ui"); openDay(key); });
			}
			row.appendChild(hex);
		}
		hive.appendChild(row);
	});
	host.appendChild(hive);

	/* SUSTAINED (day > 30): the hive stays 30, the number keeps climbing */
	if (st.status === "SUSTAINED"){
		const line = document.createElement("div");
		line.className = "sustain-line";
		line.textContent = `SUSTAINED · DAY ${st.dayNumber}`;
		host.appendChild(line);
	}

	const legend = document.createElement("div");
	legend.className = "legend";
	legend.innerHTML = `<span>Offline</span><div class="bar"></div><span>Augmented</span>`;
	host.appendChild(legend);

	/* --- actions: nothing while ACTIVE (no quitting), START OVER when
	   FAILED, ARCHIVE when SUSTAINED --- */
	const actions = document.createElement("div");
	actions.className = "prot-actions";
	if (st.status === "FAILED"){
		actions.innerHTML = `<button class="cta" id="startOverBtn"><span class="tri"></span>Start over</button>`;
		actions.querySelector("#startOverBtn").addEventListener("click", startOver);
	} else if (st.status === "SUSTAINED"){
		actions.innerHTML = `<button class="ghost" id="archiveBtn">Archive protocol</button>`;
		actions.querySelector("#archiveBtn").addEventListener("click", archiveProtocol);
	}
	host.appendChild(actions);

	if (entering) fx.cascade(hive);
}

async function initiateProtocol(){
	blip("ui");
	const ok = await confirmHud("Initiate protocol", "30 days, starting today. Strictly pass/fail: one day below 100% core and the run is dead.", { yes: "Initiate" });
	if (!ok) return;
	if (currentProtocol(state)) return; /* the button only renders when there is none — just a guard */
	state.protocols.push({ id: genId(), start: todayKey() });
	persist();
	blip("initiate");
	renderAll();
	refreshOpenPanels();
	showTab(1, { silent: true });
	toast("Protocol initiated — day 1 of 30");
}

/* FAILED → start over: the dead run is archived (its lived days stay
   red on the calendar) and a fresh 30-day window begins today. */
async function startOver(){
	blip("ui");
	const prot = currentProtocol(state);
	if (!prot) return;
	const ok = await confirmHud("Start over", "The failed run is archived — the days it lived stay red on the calendar. A fresh 30-day window starts today.", { yes: "Start over" });
	if (!ok) return;
	prot.archived = true;
	state.protocols.push({ id: genId(), start: todayKey() });
	persist();
	blip("initiate");
	renderAll();
	refreshOpenPanels();
	toast("New protocol — day 1 of 30");
}

async function archiveProtocol(){
	blip("ui");
	const prot = currentProtocol(state);
	if (!prot) return;
	const ok = await confirmHud("Archive protocol", "Removes it from this view. The window and its markers stay in the calendar history forever.", { yes: "Archive" });
	if (!ok) return;
	prot.archived = true;
	persist();
	renderAll();
	refreshOpenPanels();
	toast("Protocol archived");
}

/* Testing helper (System): deletes the current run outright, as if it was
   never initiated — no calendar markers left behind. Meant to be disabled
   for the proper go-live. */
async function resetProtocol(){
	blip("ui");
	const prot = currentProtocol(state);
	if (!prot) return;
	const ok = await confirmHud("Reset protocol", "Testing helper: removes the current run entirely, as if never initiated. No calendar markers remain.", { danger: true, yes: "Reset" });
	if (!ok) return;
	state.protocols.splice(state.protocols.indexOf(prot), 1);
	persist();
	renderAll();
	refreshOpenPanels();
	toast("Protocol reset — as if it never happened");
}

/* ============================================================
   CALENDAR (SPEC §6.3)
   ============================================================ */
function renderCal(){
	const today = effectiveToday(state.rolloverHour);
	if (!calCursor) calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
	const y = calCursor.getFullYear(), m = calCursor.getMonth();

	$("calMon").innerHTML = `${MONTHS[m]} <em>${y}</em>`;
	/* upper bound: current month (no lower bound) */
	$("calNext").disabled = (y === today.getFullYear() && m === today.getMonth()) || calCursor > today;

	const first = new Date(y, m, 1);
	const startOffset = (first.getDay() + 6) % 7; /* Monday-first */
	const daysInMonth = new Date(y, m + 1, 0).getDate();
	const earliest = dateOf(state.earliest);

	/* protocol windows from the FULL history — markers are permanent.
	   FAILED runs only mark the days they lived (start → breaking day):
	   starting over must not paint 30 red days. Newest run wins overlaps. */
	// VERIFY: calendar keeps gold/red hex markers for ALL past protocol windows across months
	const windows = state.protocols.map(p => ({
		...protocolWindow(state, p),
		color: protocolMarker(state, p),
	}));

	const grid = $("calGrid");
	grid.innerHTML = "";

	for (let i = 0; i < startOffset; i++){
		const pad = document.createElement("div");
		pad.className = "cell out";
		grid.appendChild(pad);
	}

	for (let day = 1; day <= daysInMonth; day++){
		const d = new Date(y, m, day);
		const key = keyOf(d);
		const cell = document.createElement("button");
		cell.className = "cell";
		cell.innerHTML = `<span class="dnum">${day}</span>`;

		const rel = diffDays(d, today);
		const beforeLog = diffDays(d, earliest) < 0;

		if (rel > 0){
			cell.classList.add("future");
			cell.disabled = true;
			cell.setAttribute("aria-label", `${fmtLong(d)}, upcoming`);
		} else if (beforeLog){
			cell.classList.add("pre");
			cell.disabled = true;
			cell.setAttribute("aria-label", `${fmtLong(d)}, before tracking began`);
		} else {
			const ds = dayStats(state, key);
			if (ds.ratio === 0){
				cell.classList.add("miss");
			} else {
				cell.style.background = heatColor(ds.ratio);
				if (ds.ratio >= 0.6) cell.classList.add("hot");
			}
			if (rel === 0) cell.classList.add("today");
			cell.setAttribute("aria-label", `${fmtLong(d)}, ${Math.round(ds.ratio * 100)} percent. Edit.`);
			cell.addEventListener("click", () => { blip("ui"); openDay(key); });
		}

		let marker = null;
		for (const w of windows){
			if (diffDays(d, w.startD) >= 0 && diffDays(w.endD, d) >= 0) marker = w.color;
		}
		if (marker) cell.classList.add(marker === "red" ? "prot-red" : "prot-gold");

		grid.appendChild(cell);
	}

	$("calNote").innerHTML =
		`<span class="hexdot"></span> sustained / in progress` +
		`<span class="hexdot red"></span> failed`;
}

/* ============================================================
   DAY EDITOR — hard-edged HUD panel for backfilling (SPEC §2/§6.3)
   ============================================================ */
function openDay(key){
	editingKey = key;
	renderDayHud(key);
	openOverlay($("dayHud"));
}
function renderDayHud(key){
	const d = dateOf(key);
	const s = dayStats(state, key);

	let title = fmtLong(d);
	const prot = currentProtocol(state);
	if (prot){
		const i = diffDays(d, dateOf(prot.start));
		if (i >= 0 && i < PROT_LEN) title = `Protocol day ${i + 1}`;
	}
	$("dhTitle").textContent = title;
	$("dhDate").textContent = fmtLong(d);

	const pill = $("dhHeat");
	pill.textContent = Math.round(s.ratio * 100) + "%" + (s.bonusDone ? " +" + s.bonusDone : "") + " · " + chargeWord(s);
	pill.style.color = (s.ratio > 0 || s.bonusDone > 0) ? heatColor(Math.max(s.ratio, 0.35)) : "var(--dim)";

	const host = $("dhTasks");
	host.innerHTML = "";
	state.groups.forEach(g => host.appendChild(groupEl(g, key, false)));
}
function closeDayHud(){
	if ($("dayHud").hidden) return;
	closeOverlay($("dayHud"));
	editingKey = null;
	renderAll();
}

/* ============================================================
   LOADOUT — bottom sheet editor (SPEC §6.4)
   ============================================================ */
function openLoadout(){
	renderLoadout();
	openOverlay($("loadoutHud"));
	fx.decode($("loadoutTitle")); /* once per open, not per re-render */
}
function closeLoadout(){
	if ($("loadoutHud").hidden) return;
	closeOverlay($("loadoutHud"));
	renderAll(); /* loadout edits reshape Today immediately */
}

function renderLoadout(){
	const host = $("loadoutBody");
	host.innerHTML = `
		<div class="ed-note"><b>CORE</b> defines the 100% daily minimum · <b>BONUS</b> is overcharge beyond it · <b>PASSIVE</b> are standing rules, all-or-nothing.</div>
		<div id="edWarnHost"></div>
		<div id="edGroups"></div>
		<button class="addbtn" id="addGroupBtn">+ Add group</button>
		<button class="cta restorebtn" id="restoreBtn"><span class="tri"></span>Restore standard loadout</button>`;

	/* subtle warning when the user deleted every core task (SPEC §4) */
	if (tierTasks(state.groups, "core").length === 0){
		$("edWarnHost").innerHTML = `<div class="ed-warn">No core tasks — every day counts as complete.</div>`;
	}

	const groupsHost = $("edGroups");
	state.groups.forEach((g, gi) => groupsHost.appendChild(loadoutGroupEl(g, gi)));

	$("addGroupBtn").addEventListener("click", () => {
		state.groups.push({ id: genId(), name: "New group", tasks: [] });
		persist();
		blip("ui");
		renderLoadout();
	});

	$("restoreBtn").addEventListener("click", async () => {
		blip("ui");
		const ok = await confirmHud("Restore standard loadout",
			"Re-adds any missing standard tasks to their groups. Your custom tasks and tier changes stay untouched.", { yes: "Restore" });
		if (!ok) return;
		const added = restoreStandard(state);
		persist();
		renderLoadout();
		toast(added ? `Restored ${added} standard task${added === 1 ? "" : "s"}` : "Nothing missing — already standard");
	});
}

const TIER_CYCLE = { core: "bonus", bonus: "passive", passive: "core" };
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`;

function moveItem(arr, i, dir){
	const j = i + dir;
	if (j < 0 || j >= arr.length) return false;
	[arr[i], arr[j]] = [arr[j], arr[i]];
	return true;
}

function ordBtns(list, i, onMove){
	const wrap = document.createElement("span");
	wrap.className = "ordbtns";
	const up = document.createElement("button");
	up.textContent = "▲";
	up.setAttribute("aria-label", "Move up");
	up.disabled = i === 0;
	const down = document.createElement("button");
	down.textContent = "▼";
	down.setAttribute("aria-label", "Move down");
	down.disabled = i === list.length - 1;
	// VERIFY: loadout reorder (groups + tasks) persists and reorders Today immediately
	up.addEventListener("click", () => { if (moveItem(list, i, -1)){ persist(); blip("ui"); onMove(); } });
	down.addEventListener("click", () => { if (moveItem(list, i, 1)){ persist(); blip("ui"); onMove(); } });
	wrap.append(up, down);
	return wrap;
}

function loadoutGroupEl(g, gi){
	const box = document.createElement("div");
	box.className = "ed-group";

	/* --- group head: reorder ▲▼, name input, delete --- */
	const head = document.createElement("div");
	head.className = "ed-ghead";
	head.appendChild(ordBtns(state.groups, gi, renderLoadout));

	const nameInput = document.createElement("input");
	nameInput.value = g.name;
	nameInput.setAttribute("aria-label", "Group name");
	nameInput.addEventListener("change", () => {
		g.name = nameInput.value.trim() || "Group";
		nameInput.value = g.name;
		persist();
	});
	head.appendChild(nameInput);

	const delG = document.createElement("button");
	delG.className = "delbtn";
	delG.setAttribute("aria-label", "Delete group");
	delG.innerHTML = TRASH_SVG;
	delG.addEventListener("click", async () => {
		if (g.tasks.length){
			const ok = await confirmHud("Delete group",
				`Delete "${g.name}" and its ${g.tasks.length} task${g.tasks.length === 1 ? "" : "s"}? Past check-offs of those tasks stop counting.`,
				{ danger: true, yes: "Delete" });
			if (!ok) return;
		}
		state.groups.splice(gi, 1);
		persist();
		blip("ui");
		renderLoadout();
	});
	head.appendChild(delG);
	box.appendChild(head);

	/* --- task rows: tier cycle, label input, reorder ▲▼, delete --- */
	g.tasks.forEach((t, ti) => {
		const row = document.createElement("div");
		row.className = "ed-task";

		const tier = document.createElement("button");
		tier.className = "tierbtn";
		tier.dataset.tier = t.tier;
		tier.textContent = t.tier.toUpperCase();
		tier.setAttribute("aria-label", "Cycle tier: core, bonus, passive");
		tier.addEventListener("click", () => {
			t.tier = TIER_CYCLE[t.tier] || "core";
			tier.dataset.tier = t.tier;
			tier.textContent = t.tier.toUpperCase();
			persist();
			blip("ui");
			const warnNeeded = tierTasks(state.groups, "core").length === 0;
			$("edWarnHost").innerHTML = warnNeeded ? `<div class="ed-warn">No core tasks — every day counts as complete.</div>` : "";
		});

		const input = document.createElement("input");
		input.value = t.label;
		input.setAttribute("aria-label", "Task name");
		input.addEventListener("change", () => {
			t.label = input.value.trim() || "Task";
			input.value = t.label;
			persist();
		});

		const del = document.createElement("button");
		del.className = "delbtn";
		del.setAttribute("aria-label", "Delete task");
		del.innerHTML = TRASH_SVG;
		del.addEventListener("click", () => {
			g.tasks.splice(ti, 1);
			persist();
			blip("ui");
			renderLoadout();
			toast(`Removed "${t.label}"`);
		});

		row.append(tier, input, ordBtns(g.tasks, ti, renderLoadout), del);
		box.appendChild(row);
	});

	const add = document.createElement("button");
	add.className = "addbtn";
	add.textContent = "+ Add task";
	add.addEventListener("click", () => {
		g.tasks.push({ id: genId(), label: "New task", tier: "core" });
		persist();
		blip("ui");
		renderLoadout();
		/* focus + select the new input so typing replaces the placeholder */
		const inputs = $("edGroups").children[gi]?.querySelectorAll(".ed-task input");
		const last = inputs && inputs[inputs.length - 1];
		if (last){ last.focus(); last.select(); }
	});
	box.appendChild(add);

	return box;
}

/* ============================================================
   SYSTEM — offcanvas menu (SPEC §6.5 + install + display prefs)
   ============================================================ */
function openSystem(){
	renderSystem();
	openOverlay($("systemPanel"));
	fx.decode($("systemTitle"));
}
function closeSystem(){
	if ($("systemPanel").hidden) return;
	closeOverlay($("systemPanel"));
	renderAll();
}

function installSubtitle(){
	if (matchMedia("(display-mode: standalone)").matches) return "already installed — you're running it";
	if (deferredInstall) return "add to your home screen";
	return "browser menu → Install app / Add to Home screen";
}

function renderSystem(){
	const host = $("systemBody");
	const prot = currentProtocol(state);
	const st = prot ? protocolStatus(state, prot) : null;
	const reduced = fx.prefersReduced();

	host.innerHTML = `
		<div class="menu-row">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
			<div class="mt"><b>Daily rollover</b><small>day commits &amp; checklist resets</small></div>
			<div class="roll"><input id="rollInput" type="number" min="0" max="23" inputmode="numeric" value="${state.rolloverHour}"><span>:00</span></div>
		</div>

		<div class="menu-row menu-row-tap" id="sysSoundRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4zM16 9a5 5 0 010 6"/></svg>
			<div class="mt"><b>Sounds</b><small>check-off soundboard &amp; blips</small></div>
			<button class="switch" id="soundSwitch" role="switch" aria-checked="${state.sound}" aria-label="Sounds"></button>
		</div>

		<div class="menu-row menu-row-tap" id="sysFxRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>
			<div class="mt"><b>Reduce FX</b><small>${reduced ? "forced on by system reduced-motion" : "disable animations &amp; parallax"}</small></div>
			<button class="switch" id="fxSwitch" role="switch" aria-checked="${reduced || !state.fx}" ${reduced ? 'aria-disabled="true"' : ""} aria-label="Reduce FX"></button>
		</div>

		<div class="menu-row menu-row-tap" id="sysMarksRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h13"/></svg>
			<div class="mt"><b>Checkmarks on right</b><small>flip task rows: text left, triangle right</small></div>
			<button class="switch" id="marksSwitch" role="switch" aria-checked="${!!state.marksRight}" aria-label="Checkmarks on right"></button>
		</div>

		<button class="menu-row" id="sysEditRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>
			<div class="mt"><b>Edit loadout</b><small>groups, tasks, core / bonus / passive</small></div>
		</button>

		<button class="menu-row" id="sysProtRow" hidden>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2l8 5v10l-8 5-8-5V7z"/></svg>
			<div class="mt"><b id="sysProtTitle"></b><small id="sysProtSub"></small></div>
		</button>

		<button class="menu-row danger" id="sysResetRow" hidden>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
			<div class="mt"><b>Reset protocol</b><small>testing helper — removes the run entirely</small></div>
		</button>

		<button class="menu-row" id="sysInstallRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
			<div class="mt"><b>Install app</b><small>${installSubtitle()}</small></div>
		</button>

		<button class="menu-row" id="sysExportRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M12 15l-4-4M12 15l4-4M5 21h14"/></svg>
			<div class="mt"><b>Export backup</b><small>download all data as JSON</small></div>
		</button>

		<button class="menu-row" id="sysImportRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M12 3L8 7M12 3l4 4M5 21h14"/></svg>
			<div class="mt"><b>Import backup</b><small>restore from a JSON file</small></div>
		</button>

		<button class="menu-row danger" id="sysWipeRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
			<div class="mt"><b>Wipe all data</b><small>erase log &amp; protocols — keeps the loadout</small></div>
		</button>

		<div class="sysfoot">Protocol · <b>${APP_VERSION}</b> · no cookies, no cloud, no excuses</div>`;

	/* --- rollover: re-renders but never rewrites the log (SPEC §3.3) --- */
	$("rollInput").addEventListener("change", e => {
		let h = parseInt(e.target.value, 10);
		if (isNaN(h) || h < 0) h = 0;
		if (h > 23) h = 23;
		e.target.value = h;
		state.rolloverHour = h;
		persist();
		renderAll();
		toast(`Rollover set to ${String(h).padStart(2, "0")}:00`);
	});

	/* --- sound: toggling ON plays the check sound as confirmation (SPEC §10) --- */
	$("soundSwitch").addEventListener("click", e => {
		state.sound = !state.sound;
		setSoundEnabled(state.sound);
		e.currentTarget.setAttribute("aria-checked", state.sound);
		persist();
		if (state.sound) blip("check");
	});

	/* --- FX master toggle (SPEC §9) --- */
	$("fxSwitch").addEventListener("click", e => {
		if (fx.prefersReduced()) return; /* system preference wins */
		state.fx = !state.fx;
		fx.setEnabled(state.fx);
		e.currentTarget.setAttribute("aria-checked", !state.fx);
		persist();
	});

	/* --- checkmark side --- */
	$("marksSwitch").addEventListener("click", e => {
		state.marksRight = !state.marksRight;
		document.body.classList.toggle("marks-right", state.marksRight);
		e.currentTarget.setAttribute("aria-checked", state.marksRight);
		persist();
		blip("ui");
	});

	/* the 52×28 switches are small — let the whole row toggle them */
	$("sysSoundRow").addEventListener("click", e => { if (!e.target.closest(".switch")) $("soundSwitch").click(); });
	$("sysFxRow").addEventListener("click", e => { if (!e.target.closest(".switch")) $("fxSwitch").click(); });
	$("sysMarksRow").addEventListener("click", e => { if (!e.target.closest(".switch")) $("marksSwitch").click(); });

	$("sysEditRow").addEventListener("click", () => {
		blip("ui");
		closeOverlay($("systemPanel"));
		openLoadout();
	});

	/* --- contextual protocol row (no abort — an ACTIVE run has no legit
	   exit, so the row hides) + a separate testing-only reset row that is
	   reachable in EVERY state a test session can produce --- */
	const protRow = $("sysProtRow"), protTitle = $("sysProtTitle"), protSub = $("sysProtSub");
	if (!prot){
		protRow.hidden = false;
		protTitle.textContent = "Initiate 30-day protocol";
		protSub.textContent = "begin the crucible from today";
		protRow.addEventListener("click", initiateProtocol);
	} else if (st.status === "FAILED"){
		protRow.hidden = false;
		protTitle.textContent = "Start over";
		protSub.textContent = "failed · lived days stay on the calendar";
		protRow.addEventListener("click", startOver);
	} else if (st.status === "SUSTAINED"){
		protRow.hidden = false;
		protTitle.textContent = "Archive protocol";
		protSub.textContent = "sustained · started " + fmtShort(st.startD);
		protRow.addEventListener("click", archiveProtocol);
	}
	if (prot){
		$("sysResetRow").hidden = false;
		$("sysResetRow").addEventListener("click", resetProtocol);
	}

	/* --- install (captured beforeinstallprompt, or a pointer to the browser menu) --- */
	$("sysInstallRow").addEventListener("click", async () => {
		blip("ui");
		if (matchMedia("(display-mode: standalone)").matches){
			toast("Already installed — this is the app");
			return;
		}
		if (deferredInstall){
			deferredInstall.prompt();
			const choice = await deferredInstall.userChoice.catch(() => null);
			if (choice && choice.outcome === "accepted"){
				deferredInstall = null;
				toast("Installing — check your home screen");
			}
			return;
		}
		toast("Use the browser menu: Install app / Add to Home screen");
	});

	$("sysExportRow").addEventListener("click", exportBackup);
	$("sysImportRow").addEventListener("click", () => $("fileInput").click());

	/* --- wipe: double confirm; keeps loadout, erases log + protocols (SPEC §6.5) --- */
	$("sysWipeRow").addEventListener("click", async () => {
		blip("ui");
		const first = await confirmHud("Wipe all data", "Erases the entire log and all protocol history. The loadout and settings stay.", { danger: true, yes: "Wipe" });
		if (!first) return;
		const second = await confirmHud("Confirm wipe", "There is no undo. Export a backup first if in doubt.", { danger: true, yes: "Wipe everything" });
		if (!second) return;
		const tk = todayKey();
		state.log = {};
		state.protocols = [];
		state.earliest = tk;
		state.lastBackupNudge = tk;
		persist();
		calCursor = null;
		renderAll();
		renderSystem();
		toast("All data wiped — loadout kept");
	});
}

/* ---------- backup: export / import (SPEC §6.5, §11) ---------- */
function exportBackup(){
	blip("ui");
	const blob = new Blob([storage.exportJSON(state)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `30-days-of-dahl-backup-${todayKey()}.json`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	state.lastBackupNudge = todayKey(); /* nudge clock resets on export (SPEC §11) */
	persist();
	toast("Backup downloaded");
}

// VERIFY: export → wipe → import round-trips identical state
function importBackup(file){
	const reader = new FileReader();
	reader.onload = () => {
		try {
			state = storage.importJSON(reader.result);
			const saved = persist();
			calCursor = null;
			applySettings();
			renderAll();
			refreshOpenPanels();
			/* don't let a success toast clobber persist()'s failure toast —
			   an unsaved restore silently reverts on the next launch */
			if (saved) toast("Backup restored");
		} catch (err){
			toast(err.message || "That file isn't a valid backup");
		}
	};
	reader.onerror = () => toast("Could not read that file");
	reader.readAsText(file);
}

/* ============================================================
   BACKUP NUDGE (SPEC §11)
   ============================================================ */
// VERIFY: backup nudge appears after 14 days, clears on export
function maybeNudgeBackup(){
	if (nudgeShown) return;
	const entries = Object.keys(state.log).length;
	if (entries < 7) return;
	const last = state.lastBackupNudge ? dateOf(state.lastBackupNudge) : null;
	if (last && diffDays(effectiveToday(state.rolloverHour), last) < 14) return;
	nudgeShown = true;
	toast("14 days since last backup — export from System");
}

/* ============================================================
   ROLLOVER WATCH
   ============================================================ */
// VERIFY: rollover — at 04:59 local the app shows yesterday; at 05:00 it flips and yesterday is committed
function dayTick(){
	const tk = todayKey();
	if (tk !== lastRenderedDay){
		lastRenderedDay = tk;
		calCursor = null;
		renderAll();
		refreshOpenPanels();
	}
}

/* ============================================================
   INIT
   ============================================================ */
function init(){
	applySettings();
	lastRenderedDay = todayKey();

	/* tabs — tapping animates the same slide the swipe performs */
	TAB_IDS.forEach((t, i) => $("tab-" + t).addEventListener("click", () => showTab(i)));
	initSwipe();

	/* panels */
	$("systemBtn").addEventListener("click", () => { blip("ui"); openSystem(); });
	$("systemClose").addEventListener("click", () => { blip("ui"); closeSystem(); });
	$("editLoadoutBtn").addEventListener("click", () => { blip("ui"); openLoadout(); });
	$("loadoutClose").addEventListener("click", () => { blip("ui"); closeLoadout(); });

	/* calendar month nav */
	$("calPrev").addEventListener("click", () => {
		blip("nav");
		calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
		renderCal();
	});
	$("calNext").addEventListener("click", () => {
		blip("nav");
		calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
		renderCal();
	});

	/* overlays: scrim + Escape close whatever is on top */
	$("scrim").addEventListener("click", () => {
		if (confirmResolve){ settleConfirm(false); return; }
		if (isOpen("dayHud")){ closeDayHud(); return; }
		if (isOpen("loadoutHud")){ closeLoadout(); return; }
		if (isOpen("systemPanel")) closeSystem();
	});
	$("dhDone").addEventListener("click", () => { blip("ui"); closeDayHud(); });
	$("chYes").addEventListener("click", () => { blip("ui"); settleConfirm(true); });
	$("chNo").addEventListener("click", () => { blip("ui"); settleConfirm(false); });
	document.addEventListener("keydown", e => {
		if (e.key !== "Escape") return;
		if (confirmResolve){ settleConfirm(false); return; }
		if (isOpen("dayHud")){ closeDayHud(); return; }
		if (isOpen("loadoutHud")){ closeLoadout(); return; }
		if (isOpen("systemPanel")) closeSystem();
	});

	/* import file picker */
	$("fileInput").addEventListener("change", e => {
		if (e.target.files[0]) importBackup(e.target.files[0]);
		e.target.value = "";
	});

	/* PWA install: capture the browser's prompt so the System row can fire it */
	window.addEventListener("beforeinstallprompt", e => {
		e.preventDefault();
		deferredInstall = e;
		if (isOpen("systemPanel")) renderSystem();
	});
	window.addEventListener("appinstalled", () => {
		deferredInstall = null;
		toast("Installed — Protocol is on your home screen");
	});

	/* desktop landing footer */
	$("footYear").textContent = new Date().getFullYear();
	$("footVersion").textContent = APP_VERSION;

	/* rollover watch: interval + wake-from-background */
	setInterval(dayTick, 30000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) dayTick(); });

	/* another instance saved (installed PWA + browser tab open at once):
	   whole-state saves are last-write-wins, so re-load and re-render
	   whenever a sibling writes */
	window.addEventListener("storage", e => {
		if (e.key !== storage.STORAGE_KEY || e.newValue === null) return;
		const fresh = storage.load();
		if (!fresh) return;
		state = fresh;
		applySettings();
		renderAll();
		refreshOpenPanels();
	});

	/* first paint + boot sequence (SPEC §9) */
	renderAll();
	showTab(0, { silent: true });
	fx.runBoot({
		zeroBar: () => {
			const m = $("gMolten");
			m.style.transition = "none";
			m.style.width = "0%";
			void m.offsetWidth;
			m.style.transition = "";
		},
		fillBar: () => updateMolten(false),
		title: document.querySelector(".brand b"),
	});

	if (storage.loadNotice) setTimeout(() => toast(storage.loadNotice), 1200);
	setTimeout(maybeNudgeBackup, 2600);

	/* service worker — cache-first app shell, offline after first load (SPEC §11).
	   localhost counts as a secure context, so local testing gets the SW too. */
	// VERIFY: offline — airplane mode after first load, app fully works, fonts render
	// VERIFY: install to Android home screen from kiande.com over HTTPS; standalone, no browser chrome
	if ("serviceWorker" in navigator &&
		(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))){
		navigator.serviceWorker.register("/sw.js").catch(() => { /* offline-first is progressive */ });
		/* after a deploy the new worker installs in the background while the
		   old cache serves this page — without this, the new version only
		   shows on the SECOND visit. When the fresh worker takes control,
		   reload once. hadController guards the very first install (no old
		   version on screen → nothing to swap). */
		const hadController = !!navigator.serviceWorker.controller;
		let swReloaded = false;
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			if (!hadController || swReloaded) return;
			swReloaded = true;
			location.reload();
		});
	}
}

init();
