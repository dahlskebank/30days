/* ============================================================
   model.js — date math, tier stats, streak, protocol derivation.
   Pure functions only: nothing in here touches the DOM or
   localStorage, so every rule can be tested from the console.
   ============================================================ */

export const DAY_MS = 86400000;
export const PROT_LEN = 30;

export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* ---------- date helpers ---------- */
export function pad(n){ return String(n).padStart(2, "0"); }
export function keyOf(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
export function dateOf(key){ const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/* Difference in whole days (a − b). Noon-anchoring makes the math
   immune to DST shifts: a 23/25-hour day still rounds to ±1. */
export function diffDays(a, b){
	const A = new Date(a); A.setHours(12, 0, 0, 0);
	const B = new Date(b); B.setHours(12, 0, 0, 0);
	return Math.round((A - B) / DAY_MS);
}

export function fmtLong(d){
	return WEEKDAYS[d.getDay()] + " · " + d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
}

export function genId(){ return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- effective date & rollover (SPEC §3.3) ----------
   "Today" = now − rolloverHour hours, floored to local midnight.
   Before 05:00 it is still yesterday. All log keys use effective dates. */
// VERIFY: rollover — at 04:59 local the app shows yesterday; at 05:00 it flips and yesterday is committed
export function effectiveToday(rolloverHour){
	/* Wall-clock math, not now−Nh milliseconds: subtracting absolute hours
	   drifts on DST transition days (the flip would land at 04:00 or 06:00
	   local twice a year). setHours/setDate operate on the local calendar,
	   so this flips at exactly rolloverHour every day. */
	const d = new Date();
	const stillYesterday = d.getHours() < rolloverHour;
	d.setHours(0, 0, 0, 0);
	if (stillYesterday) d.setDate(d.getDate() - 1);
	return d;
}

/* ---------- default loadout (owner's baseline, revised 2026-07-05) ----------
   Standard tasks carry fixed std_* ids so "Restore standard" can merge.
   Note: restore only re-ADDS missing ids — it never edits labels/tiers of
   tasks that already exist, so existing installs keep their versions. */
export function stdGroups(){
	return [
		{ id: "std_g_training", name: "Training", tasks: [
			{ id: "std_rowing",    label: "6 min Rowing",                tier: "bonus" },
			{ id: "std_powerlift", label: "45 min Powerlift",            tier: "bonus" },
			{ id: "std_squats",    label: "100 squats",                  tier: "core" },
			{ id: "std_situps",    label: "100 situps",                  tier: "core" },
			{ id: "std_pushups",   label: "100 pushups",                 tier: "core" },
			{ id: "std_shake",     label: "Shake+Banan",                 tier: "passive" },
		]},
		{ id: "std_g_routine", name: "Routine", tasks: [
			{ id: "std_wake",     label: "Wake-up 05:00",                tier: "core" },
			{ id: "std_bed",      label: "Make your bed",                tier: "bonus" },
			{ id: "std_cold",     label: "Cold shower",                  tier: "bonus" },
			{ id: "std_meals",    label: "3 meals max",                  tier: "passive" },
			{ id: "std_nosnack",  label: "No snacking",                  tier: "passive" },
			{ id: "std_nofap",    label: "No porn, no fap",              tier: "bonus" },
			{ id: "std_dress",    label: "Dress your best",              tier: "passive" },
			{ id: "std_teeth_am", label: "Brush teeth morning",          tier: "passive" },
			{ id: "std_teeth_pm", label: "Brush teeth evening",          tier: "passive" },
			{ id: "std_posture",  label: "Posture + eye contact",        tier: "passive" },
		]},
		{ id: "std_g_work", name: "Work", tasks: [
			{ id: "std_notebook", label: "Notebook & pen on you",        tier: "passive" },
			{ id: "std_todo",     label: "Complete today's to-do list",  tier: "passive" },
			{ id: "std_tomorrow", label: "Write tomorrow's to-do list",  tier: "passive" },
		]},
	];
}

/* First run: standard loadout, empty log, no protocols, earliest = today.
   No fake history in production (SPEC §5). */
export function defaultState(){
	const todayKey = keyOf(effectiveToday(5));
	return {
		schema: 1,
		rolloverHour: 5,
		sound: true,
		fx: true,
		marksRight: false,
		soundMode: "interrupt",
		brandName: "Protocol",
		groups: stdGroups(),
		log: {},
		protocols: [],
		earliest: todayKey,
		lastBackupNudge: todayKey,
	};
}

/* ---------- task / tier helpers (SPEC §4) ---------- */
export function allTasks(groups){ return groups.flatMap(g => g.tasks); }
export function tierTasks(groups, tier){ return allTasks(groups).filter(t => t.tier === tier); }

export function doneSet(state, key){ return new Set(state.log[key] || []); }

/* Per-day stats. Charge % = coreDone / coreTotal; bonus and passive never
   move it. Deleted tasks stop counting: only ids that still exist in the
   loadout are tallied, even though the log keeps the raw check-offs. */
export function dayStats(state, key){
	const done = doneSet(state, key);
	const tasks = allTasks(state.groups);
	const count = tier => {
		const list = tasks.filter(t => t.tier === tier);
		return { total: list.length, done: list.filter(t => done.has(t.id)).length };
	};
	const core = count("core"), bonus = count("bonus"), passive = count("passive");
	/* coreTotal 0: user deleted all core tasks — any checked task counts as
	   a complete day (SPEC §4), with a warning shown in Loadout. */
	const anyChecked = tasks.some(t => done.has(t.id));
	const ratio = core.total ? core.done / core.total : (anyChecked ? 1 : 0);
	return {
		coreDone: core.done, coreTotal: core.total,
		bonusDone: bonus.done, bonusTotal: bonus.total,
		passiveDone: passive.done, passiveTotal: passive.total,
		allPassive: passive.total > 0 && passive.done === passive.total,
		ratio,
	};
}

export function ratioOf(state, key){ return dayStats(state, key).ratio; }

/* Day states: OFFLINE → BOOTING → ACTIVE → CHARGED → AUGMENTED (100% core)
   → OVERCLOCKED (100% + ≥1 bonus)  (SPEC §4) */
export function chargeWord(s){
	if (s.ratio >= 1) return s.bonusDone > 0 ? "OVERCLOCKED" : "AUGMENTED";
	if (s.ratio >= 0.75) return "CHARGED";
	if (s.ratio >= 0.45) return "ACTIVE";
	if (s.ratio > 0 || s.bonusDone > 0) return "BOOTING";
	return "OFFLINE";
}

/* Heat color ramp, interpolated (SPEC §4):
   #1a1712 → #4a3416 → #8a5a1a → #d8952e → #ffe9b8 */
const HEAT_STOPS = [
	[0.00, [26, 23, 18]],
	[0.22, [74, 52, 22]],
	[0.48, [138, 90, 26]],
	[0.72, [216, 149, 46]],
	[1.00, [255, 233, 184]],
];
export function heatColor(t){
	t = Math.max(0, Math.min(1, t));
	for (let i = 1; i < HEAT_STOPS.length; i++){
		if (t <= HEAT_STOPS[i][0]){
			const [t0, c0] = HEAT_STOPS[i - 1], [t1, c1] = HEAT_STOPS[i];
			const f = (t - t0) / ((t1 - t0) || 1);
			const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
			return `rgb(${c[0]},${c[1]},${c[2]})`;
		}
	}
	return "rgb(255,233,184)";
}

/* ---------- streak (SPEC §7) ----------
   Consecutive days at 100% core, counting backward from today (today
   included only if already 100%), bounded by earliest. Strict: no rest
   days, no grace, passives/bonus irrelevant. */
// VERIFY: streak counts strictly (backfill a 9/10 day → streak breaks through it)
export function currentStreak(state){
	let d = effectiveToday(state.rolloverHour);
	if (ratioOf(state, keyOf(d)) < 1) d = addDays(d, -1);
	let n = 0;
	const floor = dateOf(state.earliest);
	while (diffDays(d, floor) >= 0 && ratioOf(state, keyOf(d)) >= 1){
		n++;
		d = addDays(d, -1);
	}
	return n;
}

export function bestStreakInRange(state, startD, endD){
	let best = 0, run = 0;
	for (let d = new Date(startD); diffDays(endD, d) >= 0; d = addDays(d, 1)){
		if (ratioOf(state, keyOf(d)) >= 1){ run++; best = Math.max(best, run); }
		else run = 0;
	}
	return best;
}

/* ---------- protocol derivation (SPEC §7) ----------
   Status is ALWAYS derived, never stored: past days are editable and a
   backfill must be able to un-fail a run. */

/* The protocol currently occupying the 30 Days view: newest entry in
   protocols[] not archived. Only one may be active at a time — INITIATE
   is offered only when this returns null. */
export function currentProtocol(state){
	for (let i = state.protocols.length - 1; i >= 0; i--){
		if (!state.protocols[i].archived) return state.protocols[i];
	}
	return null;
}

/* status: "ACTIVE" | "FAILED" | "SUSTAINED"
   idx      effective today − start (0-based); committed days are 0…min(idx−1, 29)
   failIdx  first committed in-window day with core ratio < 1 (or −1)
   Note: a SUSTAINED protocol does NOT re-fail if a day after day 30 is
   missed — the 30 were banked; only the streak number resets. */
// VERIFY: failing any day inside an active protocol shows FAILED; backfilling it to 100% un-fails live
// VERIFY: day 31 of a clean protocol shows SUSTAINED with counter rising; a miss after day 30 resets streak but protocol stays SUSTAINED
export function protocolStatus(state, prot){
	const today = effectiveToday(state.rolloverHour);
	const startD = dateOf(prot.start);
	/* clamped: raising rolloverHour right after initiating can push the
	   effective date behind the start — treat that as day 1, not "day 0" */
	const idx = Math.max(0, diffDays(today, startD));
	const lastCommitted = Math.min(idx - 1, PROT_LEN - 1);
	let failIdx = -1;
	for (let i = 0; i <= lastCommitted; i++){
		if (ratioOf(state, keyOf(addDays(startD, i))) < 1){ failIdx = i; break; }
	}
	let status = "ACTIVE";
	if (failIdx >= 0) status = "FAILED";
	else if (idx >= PROT_LEN) status = "SUSTAINED";
	return { idx, dayNumber: idx + 1, failIdx, status, startD };
}

/* Calendar marker color for a protocol window:
   gold — sustained, or the in-progress run · red — failed.
   There is no abort anymore: a run only ends by failing or sustaining.
   (prot.aborted is honored for backups from the brief abort-era build.) */
export function protocolMarker(state, prot){
	if (prot.aborted) return "red";
	const { status } = protocolStatus(state, prot);
	if (status === "FAILED") return "red";
	if (prot.archived && status !== "SUSTAINED") return "red";
	return "gold";
}

/* The calendar window a protocol actually occupies. A FAILED run marks
   only the days it lived (start … the breaking day) — starting over must
   not paint 30 red days into the future. Sustained / in-progress runs
   mark their full 30-day window. */
export function protocolWindow(state, prot){
	const startD = dateOf(prot.start);
	const { status, failIdx } = protocolStatus(state, prot);
	const endD = (status === "FAILED" && failIdx >= 0)
		? addDays(startD, failIdx)
		: addDays(startD, PROT_LEN - 1);
	return { startD, endD };
}

/* ---------- restore standard loadout (SPEC §5) ----------
   Re-adds any missing std_* tasks into their std_g_* groups (recreating
   groups if deleted), preserves user's tier changes for tasks that still
   exist, never touches custom tasks, never duplicates. */
// VERIFY: restore standard re-adds deleted std_* tasks, keeps custom tasks, no duplicates
export function restoreStandard(state){
	const existingIds = new Set(allTasks(state.groups).map(t => t.id));
	let added = 0;
	for (const std of stdGroups()){
		let group = state.groups.find(g => g.id === std.id);
		if (!group){
			group = { id: std.id, name: std.name, tasks: [] };
			state.groups.push(group);
		}
		for (const task of std.tasks){
			if (!existingIds.has(task.id)){
				group.tasks.push({ ...task });
				existingIds.add(task.id);
				added++;
			}
		}
	}
	return added;
}
