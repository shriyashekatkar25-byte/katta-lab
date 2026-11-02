import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, createWorld, defaultPlots, step } from '../src/lib/model';
import { addNotebookEntry, loadNotebook, readJSON, removeNotebookEntry, sanitizeCity, toCSV, writeJSON, type KV } from '../src/lib/storage';
import { describeCity, isImprovement, pts, verdict } from '../src/lib/report';

const memKV = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('storage', () => {
  it('round-trips JSON and survives corrupt values', () => {
    const kv = memKV();
    expect(writeJSON('x', { a: 1 }, kv)).toBe(true);
    expect(readJSON('x', null, kv)).toEqual({ a: 1 });
    kv.setItem('katta.v1.bad', '{not json');
    expect(readJSON('bad', 'fallback', kv)).toBe('fallback');
    expect(readJSON('x', 'none', null)).toBe('none');
  });
  it('sanitizes a damaged city', () => {
    const c = sanitizeCity({ params: { homophily: 'lots', distance: 2, monsoon: true, population: Infinity }, plotTypes: ['tapri', 'disco'], seed: -5.5 });
    expect(c.params.homophily).toBe(DEFAULT_PARAMS.homophily);
    expect(c.params.distance).toBe(2);
    expect(c.params.monsoon).toBe(true);
    expect(c.params.population).toBe(DEFAULT_PARAMS.population);
    expect(c.plotTypes).toEqual(defaultPlots().map((p) => p.type)); // wrong length → defaults
    expect(c.seed).toBe(5);
    const ok = sanitizeCity({ plotTypes: defaultPlots().map((_, i) => (i === 0 ? 'disco' : 'cafe')) });
    expect(ok.plotTypes[0]).toBeNull();
    expect(ok.plotTypes[1]).toBe('cafe');
  });
  it('notebook adds newest first, caps, and deletes', () => {
    const kv = memKV();
    const e = (id: string) => ({ id, title: id, createdAt: '2026-11-02', note: '', rows: [], runs: 1, days: 1 });
    addNotebookEntry(e('a'), kv);
    addNotebookEntry(e('b'), kv);
    expect(loadNotebook(kv).map((x) => x.id)).toEqual(['b', 'a']);
    expect(removeNotebookEntry('b', kv).map((x) => x.id)).toEqual(['a']);
    for (let i = 0; i < 50; i++) addNotebookEntry(e(`n${i}`), kv);
    expect(loadNotebook(kv)).toHaveLength(40);
  });
  it('CSV escapes commas and quotes', () => {
    expect(toCSV([{ a: 1, b: 'x,"y"' }])).toBe('a,b\n1,"x,""y"""');
    expect(toCSV([])).toBe('');
  });
});

describe('field notes', () => {
  it('speaks only from numbers', () => {
    expect(describeCity([], defaultPlots())[0]).toMatch(/No evenings/);
    const w = createWorld(DEFAULT_PARAMS, defaultPlots(), 1);
    for (let i = 0; i < 12; i++) step(w);
    const notes = describeCity(w.history, w.plots).join(' ');
    expect(notes).toMatch(/After 12 evenings/);
    expect(notes).toMatch(/dissimilarity \d\.\d\d/);
    expect(notes).toMatch(/Busiest tonight/);
  });
  it('verdicts respect the hoped-for direction', () => {
    expect(verdict(0.1, 0.2)).toBe('rise');
    expect(verdict(-0.2, -0.1)).toBe('fall');
    expect(verdict(-0.1, 0.1)).toBe('unclear');
    expect(isImprovement('isolation', 'fall')).toBe(true);
    expect(isImprovement('belonging', 'fall')).toBe(false);
    expect(isImprovement('belonging', 'unclear')).toBeNull();
    expect(pts(0.0123)).toBe('+1.2 pts');
    expect(pts(-0.05)).toBe('−5.0 pts');
  });
});
