/* ============================================================
   storage.js — ALL persistence lives behind this API (SPEC §3.2).
   Nothing outside this module may touch localStorage. The module
   boundary exists so persistence can later be swapped for a small
   PHP+SQLite sync endpoint on the same host (phase 2 — not built).
   ============================================================ */

import { defaultState, keyOf, effectiveToday } from "./model.js";

const KEY = "thirtyDaysOfDahl.v1";
export const STORAGE_KEY = KEY; /* app.js listens for cross-instance `storage` events on this */
export const CURRENT_SCHEMA = 1;

/* Migration scaffolding, alive from day one (SPEC §3.2): this app runs
   forever; the format won't. Each entry upgrades FROM that schema number
   to the next one, e.g. when schema 2 lands:
     migrations[1] = (state) => { …mutate to v2 shape…; state.schema = 2; return state; }
   migrate() walks them in order until state.schema === CURRENT_SCHEMA. */
const migrations = {
	// 1: (state) => { …; state.schema = 2; return state; },
};

function migrate(state){
	let s = state;
	while ((s.schema || 1) < CURRENT_SCHEMA){
		const step = migrations[s.schema || 1];
		if (!step) throw new Error("No migration path from schema " + s.schema);
		s = step(s);
	}
	return s;
}

const TIERS = new Set(["core", "bonus", "passive"]);

/* Coerce a parsed object into a valid state, or throw with a human
   message. Used by both load() (lenient: repairs) and importJSON()
   (the same repairs — garbage that can't be repaired is rejected). */
function normalize(raw){
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a state object");
	if (!Array.isArray(raw.groups)) throw new Error("missing groups");
	if (!raw.log || typeof raw.log !== "object" || Array.isArray(raw.log)) throw new Error("missing log");

	const todayKey = keyOf(effectiveToday(Number.isInteger(raw.rolloverHour) ? raw.rolloverHour : 5));
	const s = {
		schema: Number.isInteger(raw.schema) ? raw.schema : 1,
		rolloverHour: Number.isInteger(raw.rolloverHour) && raw.rolloverHour >= 0 && raw.rolloverHour <= 23 ? raw.rolloverHour : 5,
		sound: raw.sound !== false,
		fx: raw.fx !== false,
		marksRight: raw.marksRight === true, /* checkmark on the right side of task rows */
		soundMode: raw.soundMode === "smart" ? "smart" : "interrupt", /* always-interrupt (A, default) vs smart burst (C) */
		brandName: typeof raw.brandName === "string" && raw.brandName.trim() ? raw.brandName.trim().slice(0, 24) : "Protocol",
		groups: raw.groups.map(g => ({
			id: String(g.id || "g" + Math.random().toString(36).slice(2, 8)),
			name: String(g.name || "Group"),
			tasks: Array.isArray(g.tasks) ? g.tasks.map(t => ({
				id: String(t.id || "t" + Math.random().toString(36).slice(2, 8)),
				label: String(t.label || "Task"),
				tier: TIERS.has(t.tier) ? t.tier : "core",
			})) : [],
		})),
		log: {},
		protocols: Array.isArray(raw.protocols) ? raw.protocols
			.filter(p => p && typeof p.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.start))
			.map(p => ({
				id: String(p.id || "p" + Math.random().toString(36).slice(2, 8)),
				start: p.start,
				...(p.archived ? { archived: true } : {}),
				...(p.aborted ? { aborted: true } : {}),
			})) : [],
		earliest: typeof raw.earliest === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.earliest) ? raw.earliest : null,
		lastBackupNudge: typeof raw.lastBackupNudge === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastBackupNudge) ? raw.lastBackupNudge : todayKey,
	};

	/* log: keep only well-formed "YYYY-MM-DD": [ids] entries */
	for (const [k, v] of Object.entries(raw.log)){
		if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(v)){
			s.log[k] = v.filter(id => typeof id === "string");
		}
	}

	if (!s.earliest){
		const first = Object.keys(s.log).sort()[0];
		s.earliest = first || todayKey;
	}
	return s;
}

/* When load() had to abandon stored data, this holds a one-line human
   explanation for app.js to surface as a toast. The abandoned raw text is
   always stashed under KEY + ".corrupt" first — never silently destroyed,
   because seed() will overwrite the main key right after. */
export let loadNotice = null;

function stash(text){
	try { localStorage.setItem(KEY + ".corrupt", text); }
	catch (e){ /* quota — nothing more we can do */ }
}

/* load() → state, migrated and normalized — or null when nothing (or
   nothing salvageable) is stored, in which case the app seeds. */
export function load(){
	let text = null;
	try { text = localStorage.getItem(KEY); }
	catch (e){ return null; }
	if (!text) return null;

	let raw = null;
	try {
		raw = JSON.parse(text);
	} catch (e){
		/* truncated/interrupted write — the most common corruption mode */
		stash(text);
		loadNotice = "Stored data was unreadable — stashed for recovery, starting fresh";
		return null;
	}
	if (raw && typeof raw === "object" && (raw.schema || 1) > CURRENT_SCHEMA){
		/* data written by a FUTURE app version: normalizing would silently
		   strip fields this version doesn't know about */
		stash(text);
		loadNotice = "Data is from a newer app version — stashed for recovery, starting fresh";
		return null;
	}
	try {
		return normalize(migrate(raw));
	} catch (e){
		stash(text);
		loadNotice = "Stored data was damaged — stashed for recovery, starting fresh";
		return null;
	}
}

export function save(state){
	try {
		localStorage.setItem(KEY, JSON.stringify(state));
		return true;
	} catch (e){
		return false; /* storage full or blocked — app.js shows the toast */
	}
}

export function seed(){
	const state = defaultState();
	save(state);
	return state;
}

/* ---------- backup (SPEC §6.5 / §11) ---------- */
// VERIFY: export → wipe → import round-trips identical state
export function exportJSON(state){
	return JSON.stringify(state, null, 2);
}

/* Validates shape, migrates, rejects garbage with a clear message
   (app.js surfaces it as a toast). */
export function importJSON(text){
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (e){
		throw new Error("That file isn't JSON at all");
	}
	if (!raw || typeof raw !== "object" || !raw.log || !Array.isArray(raw.groups)){
		throw new Error("That file isn't a 30 Days of Dahl backup");
	}
	if ((raw.schema || 1) > CURRENT_SCHEMA){
		throw new Error("Backup is from a newer version of the app");
	}
	try {
		return normalize(migrate(raw));
	} catch (e){
		throw new Error("Backup is damaged: " + e.message);
	}
}

/* Ask the browser to protect localStorage from eviction (SPEC §11).
   Called once on first run; failing silently is fine. */
export async function requestPersist(){
	try {
		if (navigator.storage && navigator.storage.persist){
			const already = await navigator.storage.persisted();
			if (!already) await navigator.storage.persist();
		}
	} catch (e){ /* unsupported — nothing to do */ }
}
