/**
 * Local-first persistence. Everything lives in this browser's localStorage under
 * one versioned namespace; every read and write is guarded, because storage can
 * be absent (private windows), full, or hold stale shapes from older versions.
 */
import { DEFAULT_PARAMS, PLACE_TYPES, defaultPlots, type Params, type PlaceType, type Plot } from './model';

export const NS = 'katta.v1';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): KV | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

export function readJSON<T>(key: string, fallback: T, kv: KV | null = store()): T {
  if (!kv) return fallback;
  try {
    const raw = kv.getItem(`${NS}.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown, kv: KV | null = store()): boolean {
  if (!kv) return false;
  try {
    kv.setItem(`${NS}.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export interface CityState {
  params: Params;
  plotTypes: (PlaceType | null)[];
  seed: number;
}

/** Validate and repair a stored city so a corrupted or older save never breaks the app. */
export function sanitizeCity(raw: unknown): CityState {
  const base: CityState = {
    params: { ...DEFAULT_PARAMS },
    plotTypes: defaultPlots().map((p) => p.type),
    seed: 2004,
  };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<CityState>;
  if (r.params && typeof r.params === 'object') {
    for (const k of Object.keys(DEFAULT_PARAMS) as (keyof Params)[]) {
      const v = (r.params as unknown as Record<string, unknown>)[k];
      if (typeof v === typeof DEFAULT_PARAMS[k] && (typeof v !== 'number' || Number.isFinite(v))) {
        (base.params as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
  if (Array.isArray(r.plotTypes) && r.plotTypes.length === base.plotTypes.length) {
    base.plotTypes = r.plotTypes.map((t) => (t && PLACE_TYPES.includes(t) ? t : null));
  }
  if (typeof r.seed === 'number' && Number.isFinite(r.seed)) base.seed = Math.floor(Math.abs(r.seed)) % 1e9;
  return base;
}

export function plotsFromTypes(types: (PlaceType | null)[]): Plot[] {
  return defaultPlots().map((p, i) => ({ ...p, type: types[i] ?? null }));
}

export interface NotebookEntry {
  id: string;
  title: string;
  createdAt: string;
  note: string;
  /** Headline numbers, kept small on purpose. */
  rows: { outcome: string; a: number; b: number; lo: number; hi: number }[];
  runs: number;
  days: number;
}

export function loadNotebook(kv: KV | null = store()): NotebookEntry[] {
  const v = readJSON<unknown>('notebook', [], kv);
  return Array.isArray(v) ? (v.filter((e) => e && typeof e === 'object' && 'id' in e) as NotebookEntry[]) : [];
}

export function addNotebookEntry(entry: NotebookEntry, kv: KV | null = store()): NotebookEntry[] {
  const list = [entry, ...loadNotebook(kv)].slice(0, 40);
  writeJSON('notebook', list, kv);
  return list;
}

export function removeNotebookEntry(id: string, kv: KV | null = store()): NotebookEntry[] {
  const list = loadNotebook(kv).filter((e) => e.id !== id);
  writeJSON('notebook', list, kv);
  return list;
}

/** CSV for the daily ledger. */
export function toCSV(rows: Record<string, number | string | boolean>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
