/* ============================================================
   storage.js — ALL persistence lives behind this API (SPEC §3.2).
   Nothing outside this module may touch localStorage. The module
   boundary exists so persistence can later be swapped for a small
   PHP+SQLite sync endpoint on the same host (phase 2 — not built).
   ============================================================ */

import { defaultState, keyOf, effectiveToday } from "./model.js";

const KEY = "thirtyDaysOfDahl.v1";
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

/* load() → state, migrated and normalized — or null when nothing (or
   nothing salvageable) is stored, in which case the app seeds. */
export function load(){
	let raw = null;
	try {
		const text = localStorage.getItem(KEY);
		if (!text) return null;
		raw = JSON.parse(text);
	} catch (e){
		return null;
	}
	try {
		return normalize(migrate(raw));
	} catch (e){
		/* Corrupt beyond repair. Don't overwrite it silently — stash the
		   wreck under a side key so it can be recovered by hand. */
		try { localStorage.setItem(KEY + ".corrupt", localStorage.getItem(KEY)); } catch (e2){ /* full */ }
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
