/* ============================================================
   app.js — entry point: init, view switching, render
   orchestration, events. Rendering is deliberately dumb: every
   interaction mutates state, saves, and re-renders the current
   view from scratch. At this app's size that is instant, and it
   makes un-fail / rollover / reorder correctness automatic.
   ============================================================ */

import * as storage from "./storage.js";
import {
	PROT_LEN, MONTHS, keyOf, dateOf, addDays, diffDays, fmtLong, genId,
	effectiveToday, dayStats, chargeWord, heatColor, currentStreak,
	bestStreakInRange, currentProtocol, protocolStatus, protocolMarker,
	restoreStandard, tierTasks, allTasks,
} from "./model.js";
import { blip, setEnabled as setSoundEnabled } from "./sound.js";
import * as fx from "./fx.js";

const APP_VERSION = "v1.0.0";

/* ---------- state ---------- */
let state = storage.load();
const firstRun = !state;
if (firstRun){
	state = storage.seed();
	storage.requestPersist();
}

let currentView = "today";          /* today | prot | cal | loadout | system */
let viewHistory = [];               /* for the ◄ BACK button on full-screen views */
let calCursor = null;               /* first-of-month Date the calendar shows */
let editingKey = null;              /* day the editor overlay has open */
let lastRenderedDay = null;
let nudgeShown = false;

/* ---------- tiny DOM helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function todayKey(){ return keyOf(effectiveToday(state.rolloverHour)); }
function fmtShort(d){ return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear(); }

function persist(){
	if (!storage.save(state)) toast("Could not save — storage full or blocked");
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
		openOverlay(hud);
	});
}
function settleConfirm(answer){
	closeOverlay($("confirmHud"));
	if (confirmResolve){ confirmResolve(answer); confirmResolve = null; }
}

/* ---------- overlay open/close (scrim + snap-in HUD panels) ---------- */
function openOverlay(hud){
	$("scrim").classList.add("open");
	hud.hidden = false;
	requestAnimationFrame(() => requestAnimationFrame(() => hud.classList.add("open")));
}
function closeOverlay(hud){
	hud.classList.remove("open");
	setTimeout(() => { hud.hidden = true; }, 220);
	if (!anyOverlayOpen()) $("scrim").classList.remove("open");
}
function anyOverlayOpen(){
	return !!document.querySelector(".hud.open");
}

/* ============================================================
   VIEW SWITCHING (SPEC §2) — no URL routing, straight view swap.
   Full-screen views (loadout/system) hide the tab bar and show
   the chamfered ◄ BACK instead.
   ============================================================ */
const SCREEN_IDS = {
	today: "screen-today", prot: "screen-prot", cal: "screen-cal",
	loadout: "screen-loadout", system: "screen-system",
};
const FULL_VIEWS = new Set(["loadout", "system"]);

function renderView(name, opts = {}){
	if (name === "today") renderToday();
	else if (name === "prot") renderProt(opts);
	else if (name === "cal") renderCal();
	else if (name === "loadout") renderLoadout();
	else if (name === "system") renderSystem();
}

function showView(name, { transition = true } = {}){
	currentView = name;
	for (const [key, id] of Object.entries(SCREEN_IDS)) $(id).hidden = (key !== name);
	const isFull = FULL_VIEWS.has(name);
	$("nav").hidden = isFull;
	$("backBtn").hidden = !isFull;
	if (!isFull){
		viewHistory = [];
		$("tab-today").setAttribute("aria-selected", name === "today");
		$("tab-prot").setAttribute("aria-selected", name === "prot");
		$("tab-cal").setAttribute("aria-selected", name === "cal");
	}
	renderView(name, { entering: true });
	const screenEl = $(SCREEN_IDS[name]);
	if (transition){
		if (isFull) fx.fullSlide(screenEl);
		else fx.tabFlicker(screenEl);
	}
	window.scrollTo(0, 0);
}

function openFull(name){
	viewHistory.push(currentView);
	showView(name);
}
/* BACK returns to the previous view and re-renders it (SPEC §6.4) —
   so loadout edits show up in Today/System immediately. */
function goBack(){
	const prev = viewHistory.pop() || "today";
	showView(prev);
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
		btn.addEventListener("click", () => onToggleTask(key, t, live));
		wrap.appendChild(btn);
	});
	return wrap;
}

/* The check moment (SPEC §9) — sound + burst + bar flash + haptics,
   and the AUGMENTED / passive-online transitions. */
function onToggleTask(key, task, live){
	const before = dayStats(state, key);

	const arr = (state.log[key] || []).slice();
	const at = arr.indexOf(task.id);
	const nowDone = at < 0;
	if (nowDone) arr.push(task.id); else arr.splice(at, 1);
	state.log[key] = arr;
	persist();

	const after = dayStats(state, key);
	const crossedFull = before.ratio < 1 && after.ratio >= 1;

	// VERIFY: checking the last core task fires arpeggio + AUGMENTED decode; unchecking reverts state
	blip(!nowDone ? "uncheck" : (crossedFull ? "full" : "check"));

	/* re-render, then point the FX at the freshly-built nodes */
	if (live) renderToday();
	else {
		renderDayHud(key);
		renderView(currentView); /* un-fail must show through the overlay immediately (SPEC §7) */
	}
	const scope = live ? $("screen-today") : $("dayHud");
	const markEl = scope.querySelector(`.task[data-task-id="${task.id}"] .mark`);
	if (nowDone) fx.checkMoment(markEl, live ? $("gMolten") : null);
	if (live){
		if (crossedFull) fx.augmented(document.querySelector("#screen-today .crucible"), $("gState"));
		if (!before.allPassive && after.allPassive) fx.passiveFlash($("ptri"));
	}
}

/* ============================================================
   30 DAYS (SPEC §6.2)
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
				} else if (ds.ratio === 0 && ds.bonusDone === 0){
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

	/* --- ghost action: abort (active) / archive (failed or sustained) --- */
	// VERIFY: abort = red-marked window on calendar, permanent; archive removes from 30 Days view only
	const actions = document.createElement("div");
	actions.className = "prot-actions";
	const isActive = st.status === "ACTIVE";
	actions.innerHTML = `<button class="ghost" id="endProtBtn">${isActive ? "Abort protocol" : "Archive protocol"}</button>`;
	actions.querySelector("#endProtBtn").addEventListener("click", async () => {
		blip("ui");
		const ok = isActive
			? await confirmHud("Abort protocol", "An aborted run marks this window red on the calendar, permanently. Quitting is failing.", { danger: true, yes: "Abort" })
			: await confirmHud("Archive protocol", "Removes it from this view. The window and its markers stay in the calendar history forever.", { yes: "Archive" });
		if (!ok) return;
		prot.archived = true;
		persist();
		renderProt();
		toast(isActive ? "Protocol aborted — the log runs on" : "Protocol archived");
	});
	host.appendChild(actions);

	if (entering) fx.cascade(hive);
}

async function initiateProtocol(){
	blip("ui");
	const ok = await confirmHud("Initiate protocol", "30 days, starting today. Strictly pass/fail: one day below 100% core and the run is dead.", { yes: "Initiate" });
	if (!ok) return;
	/* only one protocol may be active at a time — the button only renders
	   when currentProtocol() is null, this is just a guard */
	if (currentProtocol(state)) return;
	state.protocols.push({ id: genId(), start: todayKey() });
	persist();
	blip("full");
	renderView(currentView);
	if (currentView !== "prot") showView("prot");
	toast("Protocol initiated — day 1 of 30");
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
	   Newest protocol wins where archived windows overlap a newer one. */
	// VERIFY: calendar keeps gold/red hex markers for ALL past protocol windows across months
	const windows = state.protocols.map(p => ({
		startD: dateOf(p.start),
		endD: addDays(dateOf(p.start), PROT_LEN - 1),
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
			/* before tracking began: inert outline */
			cell.classList.add("pre");
			cell.disabled = true;
			cell.setAttribute("aria-label", `${fmtLong(d)}, before tracking began`);
		} else {
			const ds = dayStats(state, key);
			if (ds.ratio === 0 && ds.bonusDone === 0){
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
		`<span class="hexdot red"></span> failed / aborted`;
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
	renderView(currentView);
}

/* ============================================================
   LOADOUT — full-screen editor (SPEC §6.4)
   ============================================================ */
function renderLoadout(){
	const host = $("screen-loadout");
	host.innerHTML = `
		<h2 id="loadoutTitle">Loadout</h2>
		<div class="sub">Groups &amp; tasks — changes save instantly</div>
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
		blip("check");
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

	fx.decode($("loadoutTitle"));
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
		blip("uncheck");
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
			/* the no-core warning may need to appear/vanish */
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
			blip("uncheck");
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
		blip("check");
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
   SYSTEM — full-screen settings (SPEC §6.5)
   ============================================================ */
function renderSystem(){
	const host = $("screen-system");
	const prot = currentProtocol(state);
	const st = prot ? protocolStatus(state, prot) : null;
	const reduced = fx.prefersReduced();

	host.innerHTML = `
		<h2 id="systemTitle">System</h2>
		<div class="sub">All data stays on this device</div>

		<div class="menu-row">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
			<div class="mt"><b>Daily rollover</b><small>day commits &amp; checklist resets</small></div>
			<div class="roll"><input id="rollInput" type="number" min="0" max="23" inputmode="numeric" value="${state.rolloverHour}"><span>:00</span></div>
		</div>

		<div class="menu-row">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4zM16 9a5 5 0 010 6"/></svg>
			<div class="mt"><b>UI sounds</b><small>feedback blips on check-off</small></div>
			<button class="switch" id="soundSwitch" role="switch" aria-checked="${state.sound}" aria-label="UI sounds"></button>
		</div>

		<div class="menu-row">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>
			<div class="mt"><b>Reduce FX</b><small>${reduced ? "forced on by system reduced-motion" : "disable animations &amp; parallax"}</small></div>
			<button class="switch" id="fxSwitch" role="switch" aria-checked="${reduced || !state.fx}" ${reduced ? 'aria-disabled="true"' : ""} aria-label="Reduce FX"></button>
		</div>

		<button class="menu-row" id="sysEditRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>
			<div class="mt"><b>Edit loadout</b><small>groups, tasks, core / bonus / passive</small></div>
		</button>

		<button class="menu-row" id="sysProtRow">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2l8 5v10l-8 5-8-5V7z"/></svg>
			<div class="mt"><b id="sysProtTitle"></b><small id="sysProtSub"></small></div>
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

		<div class="sysfoot">30 Days of Dahl · <b>${APP_VERSION}</b> · no cookies, no cloud, no excuses</div>`;

	/* --- rollover: re-renders but never rewrites the log (SPEC §3.3) --- */
	$("rollInput").addEventListener("change", e => {
		let h = parseInt(e.target.value, 10);
		if (isNaN(h) || h < 0) h = 0;
		if (h > 23) h = 23;
		e.target.value = h;
		state.rolloverHour = h;
		persist();
		toast(`Rollover set to ${String(h).padStart(2, "0")}:00`);
	});

	/* --- sound: toggling ON plays the check blip as confirmation (SPEC §10) --- */
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

	$("sysEditRow").addEventListener("click", () => { blip("ui"); openFull("loadout"); });

	/* --- contextual protocol row --- */
	const protTitle = $("sysProtTitle"), protSub = $("sysProtSub");
	if (!prot){
		protTitle.textContent = "Initiate 30-day protocol";
		protSub.textContent = "begin the crucible from today";
	} else if (st.status === "ACTIVE"){
		protTitle.textContent = "Abort 30-day protocol";
		protSub.textContent = "running since " + fmtShort(st.startD);
	} else {
		protTitle.textContent = "Archive protocol";
		protSub.textContent = st.status.toLowerCase() + " · started " + fmtShort(st.startD);
	}
	$("sysProtRow").addEventListener("click", async () => {
		if (!prot){ initiateProtocol(); return; }
		blip("ui");
		const isActive = st.status === "ACTIVE";
		const ok = isActive
			? await confirmHud("Abort protocol", "An aborted run marks this window red on the calendar, permanently. Quitting is failing.", { danger: true, yes: "Abort" })
			: await confirmHud("Archive protocol", "Removes it from the 30 Days view. The window stays in the calendar history forever.", { yes: "Archive" });
		if (!ok) return;
		prot.archived = true;
		persist();
		renderSystem();
		toast(isActive ? "Protocol aborted — the log runs on" : "Protocol archived");
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
		renderSystem();
		toast("All data wiped — loadout kept");
	});

	fx.decode($("systemTitle"));
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

function importBackup(file){
	const reader = new FileReader();
	reader.onload = () => {
		try {
			state = storage.importJSON(reader.result);
			persist();
			calCursor = null;
			setSoundEnabled(state.sound);
			fx.setEnabled(state.fx && !fx.prefersReduced());
			renderView(currentView);
			toast("Backup restored");
		} catch (err){
			toast(err.message || "That file isn't a valid backup");
		}
	};
	reader.onerror = () => toast("Could not read that file");
	reader.readAsText(file);
}

/* ============================================================
   BACKUP NUDGE (SPEC §11) — once per session, if the log has ≥ 7
   entries and the last nudge/export is ≥ 14 days old.
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
   ROLLOVER WATCH — when the effective day flips (05:00 by
   default), whatever view is open re-renders on the new day.
   ============================================================ */
// VERIFY: rollover — at 04:59 local the app shows yesterday; at 05:00 it flips and yesterday is committed
function dayTick(){
	const tk = todayKey();
	if (tk !== lastRenderedDay){
		lastRenderedDay = tk;
		calCursor = null;
		renderView(currentView);
	}
}

/* ============================================================
   INIT
   ============================================================ */
function init(){
	setSoundEnabled(state.sound);
	fx.setEnabled(state.fx && !fx.prefersReduced());
	lastRenderedDay = todayKey();

	/* tabs */
	$("tab-today").addEventListener("click", () => { blip("nav"); showView("today"); });
	$("tab-prot").addEventListener("click", () => { blip("nav"); showView("prot"); });
	$("tab-cal").addEventListener("click", () => { blip("nav"); showView("cal"); });

	/* full-screen views */
	$("systemBtn").addEventListener("click", () => { blip("ui"); openFull("system"); });
	$("editLoadoutBtn").addEventListener("click", () => { blip("ui"); openFull("loadout"); });
	$("backBtn").addEventListener("click", () => { blip("ui"); goBack(); });

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

	/* overlays */
	$("scrim").addEventListener("click", () => {
		if (confirmResolve) settleConfirm(false);
		closeDayHud();
	});
	$("dhDone").addEventListener("click", () => { blip("ui"); closeDayHud(); });
	$("chYes").addEventListener("click", () => { blip("ui"); settleConfirm(true); });
	$("chNo").addEventListener("click", () => { blip("ui"); settleConfirm(false); });
	document.addEventListener("keydown", e => {
		if (e.key === "Escape"){
			if (confirmResolve) settleConfirm(false);
			else closeDayHud();
		}
	});

	/* import file picker */
	$("fileInput").addEventListener("change", e => {
		if (e.target.files[0]) importBackup(e.target.files[0]);
		e.target.value = "";
	});

	/* desktop footer */
	$("footYear").textContent = new Date().getFullYear();
	$("footVersion").textContent = APP_VERSION;

	/* rollover watch: interval + wake-from-background */
	setInterval(dayTick, 30000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) dayTick(); });

	/* first paint + boot sequence (SPEC §9) */
	showView("today", { transition: false });
	fx.runBoot({
		fillBar: () => updateMolten(true),
		title: document.querySelector(".brand b"),
	});

	setTimeout(maybeNudgeBackup, 1600);

	/* service worker — cache-first app shell, offline after first load (SPEC §11) */
	// VERIFY: offline — airplane mode after first load, app fully works, fonts render
	// VERIFY: install to Android home screen from kiande.com over HTTPS; standalone, no browser chrome
	if ("serviceWorker" in navigator && location.protocol === "https:"){
		navigator.serviceWorker.register("/sw.js").catch(() => { /* offline-first is progressive */ });
	}
}

init();
