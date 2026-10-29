/**
 * KATTA controller: owns the scenario (source of truth), the running Sim,
 * the animation clock, and wires the three columns plus the experiment.
 */
import './styles/main.css';
import {
  PLACE_KEYS, PLACE_TYPES, PRESETS, makePlace, presetScenario, settle, syncPlaceIds,
  type Params, type Place, type PlaceKey, type PresetKey, type Scenario,
} from './lib/city';
import { Sim } from './lib/model';
import { STRONG, WEAK } from './lib/metrics';
import { writeNotes, type Note } from './lib/notes';
import { Store, type Settings } from './lib/storage';
import { OUTCOMES, compareOutcome, runExperiment, toCSV, type ExperimentResult } from './lib/experiment';
import { MapView, type Pick } from './ui/mapView';
import { WebView } from './ui/webView';
import { diffPlot, sparkline, stripPlot, svg } from './ui/charts';
import { $, download, h, pct } from './ui/dom';

type Tool = 'inspect' | 'remove' | PlaceKey;

const store = new Store(safeLocalStorage());
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  scenario: store.loadCurrent() ?? presetScenario('peth'),
  sim: null as unknown as Sim,
  settings: store.loadSettings() as Settings,
  t: 0.5,
  playing: false,
  view: 'map' as 'map' | 'web',
  tool: 'inspect' as Tool,
  selected: null as Pick,
  hover: null as Pick,
  notes: [] as Note[],
  dirty: true,
  expA: null as Scenario | null,
  expB: null as Scenario | null,
  result: null as ExperimentResult | null,
};
syncPlaceIds(state.scenario.places);

const canvas = $('#city') as HTMLCanvasElement;
const wrap = $('#canvas-wrap');
const mapView = new MapView(canvas);
const webView = new WebView(canvas);

function safeLocalStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

// ---------------------------------------------------------------- city lifecycle
function rebuild(keepTime = false): void {
  state.sim = new Sim(state.scenario.params, state.scenario.places);
  state.notes = [];
  state.selected = null;
  if (!keepTime) state.t = 0.5;
  mapView.resize(state.scenario.params.form, state.sim);
  mapView.clearTrails();
  webView.reset(state.sim);
  advance(1, false);
  syncUI();
}

function persist(): void {
  store.saveCurrent(state.scenario);
}

function placesChanged(): void {
  state.sim.setPlaces(state.scenario.places);
  persist();
  state.dirty = true;
  $('#empty').hidden = state.scenario.places.length > 0;
  renderInspector();
  renderLedger();
}

function advance(days: number, animateTrails = true): void {
  for (let d = 0; d < days; d++) {
    state.sim.stepDay();
    state.notes.unshift(...writeNotes(state.sim).reverse());
    if (animateTrails) mapView.fadeTrails();
  }
  state.notes = state.notes.slice(0, 40);
  webView.refreshEdges(state.sim);
  renderNotebook();
  renderNotes();
  renderInspector();
  renderLedger();
  $('#dateline').textContent = `Evening ${state.sim.day}`;
  state.dirty = true;
}

// ---------------------------------------------------------------- levers
const SLIDERS: { key: keyof Params; label: string; min: number; max: number; step: number; restart: boolean; fmt: (v: number) => string; help: string }[] = [
  { key: 'population', label: 'Population', min: 120, max: 600, step: 20, restart: true, fmt: (v) => String(v), help: 'Synthetic people in the city.' },
  { key: 'newcomerShare', label: 'Newcomers', min: 0.1, max: 0.7, step: 0.05, restart: true, fmt: (v) => pct(v), help: 'Share who recently moved in and know nobody.' },
  { key: 'residentialMix', label: 'Housing mix', min: 0, max: 1, step: 0.05, restart: true, fmt: (v) => pct(v), help: '0% sorts newcomers to the edges; 100% houses anyone anywhere.' },
  { key: 'sociability', label: 'Sociability', min: 0.2, max: 0.9, step: 0.05, restart: true, fmt: (v) => pct(v), help: 'Average chance of going out on an evening.' },
  { key: 'homophily', label: 'Homophily', min: 0, max: 2.5, step: 0.1, restart: false, fmt: (v) => v.toFixed(1), help: 'Pull towards places where "people like me" go.' },
  { key: 'distanceCost', label: 'Cost of distance', min: 0.2, max: 3, step: 0.1, restart: false, fmt: (v) => v.toFixed(1), help: 'How much a long walk puts people off.' },
  { key: 'priceSensitivity', label: 'Price sensitivity', min: 0, max: 3, step: 0.1, restart: false, fmt: (v) => v.toFixed(1), help: 'How much a price keeps lower budgets out.' },
  { key: 'crossFriction', label: 'Cross-group friction', min: 0, max: 0.9, step: 0.05, restart: false, fmt: (v) => pct(v), help: 'How much slower ties grow between the two groups.' },
];

function buildLevers(): void {
  const box = $('#param-sliders');
  box.replaceChildren();
  for (const s of SLIDERS) {
    const id = `p-${s.key}`;
    const out = h('output', { for: id });
    const input = h('input', { id, type: 'range', min: s.min, max: s.max, step: s.step, 'aria-describedby': `${id}-help` });
    const field = h('label', { class: 'field' },
      h('span', { class: 'field-label' }, s.label + (s.restart ? ' ·' : ''), out),
      input,
      h('span', { id: `${id}-help`, class: 'small muted', text: s.help }));
    if (s.restart) field.title = 'Changing this restarts the city';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      (state.scenario.params[s.key] as number) = v;
      out.textContent = s.fmt(v);
      if (!s.restart) {
        (state.sim.params[s.key] as number) = v;
        persist();
      }
    });
    input.addEventListener('change', () => {
      if (s.restart) { persist(); rebuild(); }
    });
    box.append(field);
  }
  const addTools = $('#add-tools');
  addTools.replaceChildren(...PLACE_KEYS.map((k) => h('button', { class: 'tool', 'data-tool': k, 'aria-pressed': 'false', title: PLACE_TYPES[k].blurb },
    PLACE_TYPES[k].label, h('span', { class: 'tool-deva', lang: 'mr', text: PLACE_TYPES[k].deva }))));
}

function syncUI(): void {
  const p = state.scenario.params;
  for (const s of SLIDERS) {
    const input = document.getElementById(`p-${s.key}`) as HTMLInputElement;
    input.value = String(p[s.key]);
    (input.parentElement!.querySelector('output') as HTMLOutputElement).textContent = s.fmt(p[s.key] as number);
  }
  ($('#seed') as HTMLInputElement).value = String(p.seed);
  ($('#pace') as HTMLInputElement).value = String(state.settings.secondsPerDay);
  $('#pace-out').textContent = `${state.settings.secondsPerDay}s`;
  ($('#trails') as HTMLInputElement).checked = state.settings.trails;
  const presetKey = (Object.keys(PRESETS) as PresetKey[]).find((k) => PRESETS[k].title === state.scenario.name);
  if (presetKey) ($('#preset') as HTMLSelectElement).value = presetKey;
  $('#preset-dek').textContent = presetKey ? PRESETS[presetKey].dek : `Your city: “${state.scenario.name}”.`;
  $('#empty').hidden = state.scenario.places.length > 0;
  renderSaved();
}

function setPlaying(on: boolean): void {
  state.playing = on;
  const b = $('#play');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Pause' : 'Play';
  const o = $('#play-overlay');
  o.setAttribute('aria-label', on ? 'Pause the evenings' : 'Play the evenings');
  o.firstElementChild!.textContent = on ? '❚❚' : '▶';
}

function setTool(tool: Tool): void {
  state.tool = tool;
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  wrap.classList.toggle('tool-add', PLACE_KEYS.includes(tool as PlaceKey));
  wrap.classList.toggle('tool-remove', tool === 'remove');
}

function setView(view: 'map' | 'web'): void {
  state.view = view;
  $('#tab-map').setAttribute('aria-selected', String(view === 'map'));
  $('#tab-web').setAttribute('aria-selected', String(view === 'web'));
  wrap.setAttribute('aria-labelledby', view === 'map' ? 'tab-map' : 'tab-web');
  $('.toolbar').style.visibility = view === 'map' ? 'visible' : 'hidden';
  ($('.legend') as HTMLElement).style.visibility = view === 'map' ? 'visible' : 'hidden';
  $('#clock').hidden = view !== 'map';
  if (view === 'map') mapView.resize(state.scenario.params.form, state.sim);
  state.dirty = true;
}

// ---------------------------------------------------------------- notebook
const METRIC_ROWS = [
  { key: 'belonging', label: 'Belonging · residents vs newcomers', value: (s: Sim) => s.history.at(-1)!.belonging.toFixed(2), a: (s: Sim) => s.history.map((m) => m.belongingResidents), b: (s: Sim) => s.history.map((m) => m.belongingNewcomers), domain: [0, 1] as [number, number] },
  { key: 'gap', label: 'Belonging gap (residents − newcomers)', value: (s: Sim) => signed(s.history.at(-1)!.gap), a: (s: Sim) => s.history.map((m) => m.gap) },
  { key: 'isolated', label: 'People with no ties', value: (s: Sim) => pct(s.history.at(-1)!.isolated), a: (s: Sim) => s.history.map((m) => m.isolated), domain: [0, 1] as [number, number] },
  { key: 'mixing', label: 'Cross-group mixing, × chance', value: (s: Sim) => `${s.history.at(-1)!.mixing.toFixed(2)}<small>×</small>`, a: (s: Sim) => s.history.map((m) => m.mixing) },
  { key: 'dissimilarity', label: 'Dissimilarity across places', value: (s: Sim) => s.history.at(-1)!.dissimilarity.toFixed(2), a: (s: Sim) => s.history.map((m) => m.dissimilarity), domain: [0, 1] as [number, number] },
  { key: 'outing', label: 'Out tonight', value: (s: Sim) => pct(s.history.at(-1)!.outing), a: (s: Sim) => s.history.map((m) => m.outing), domain: [0, 1] as [number, number] },
];

function signed(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
}

function buildNotebook(): void {
  $('#metrics').replaceChildren(...METRIC_ROWS.map((r) =>
    h('div', { class: 'metric', id: `m-${r.key}` },
      h('span', { class: 'metric-label', text: r.label }),
      h('span', { class: 'metric-value' }),
      svg(200, 26, `${r.label} over time`))));
}

function renderNotebook(): void {
  const s = state.sim;
  if (!s.history.length) return;
  for (const r of METRIC_ROWS) {
    const row = document.getElementById(`m-${r.key}`)!;
    row.querySelector('.metric-value')!.innerHTML = r.value(s);
    const series = r.a(s).slice(-90);
    const b = r.b ? r.b(s).slice(-90) : undefined;
    sparkline(row.querySelector('svg')!, series, b, r.domain);
  }
}

function renderLedger(): void {
  const body = $('#ledger');
  const s = state.sim;
  if (!state.scenario.places.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 4, class: 'ledger-empty', text: 'No places yet. Add one from the toolbar.' })));
  } else {
    const rows = state.scenario.places
      .map((p) => ({ p, st: placeStats(p) }))
      .sort((a, b) => b.st.tonight - a.st.tonight);
    body.replaceChildren(...rows.map(({ p, st }) => {
      const sel = state.selected?.kind === 'place' && state.selected.id === p.id;
      const btn = h('button', { class: 'lp', 'aria-pressed': String(sel) }, p.name, h('small', { text: `${PLACE_TYPES[p.type].label}${p.price === 0 ? ' · free' : ''}` }));
      btn.addEventListener('click', () => { state.selected = { kind: 'place', id: p.id }; renderInspector(); renderLedger(); state.dirty = true; });
      const scale = Math.max(p.capacity * 1.6, st.tonight, 1);
      const bar = h('div', { class: 'bar', role: 'img', 'aria-label': `${st.tonight} of ${p.capacity}` },
        h('i', { style: `width:${(st.tonight / scale) * 100}%` }), h('b', { style: `left:${(p.capacity / scale) * 100}%` }));
      return h('tr', { class: sel ? 'is-sel' : '' },
        h('td', {}, btn),
        h('td', {}, bar, h('span', { class: 'bar-label', text: st.open ? `${st.tonight} / ${p.capacity}` : 'closed tonight' })),
        h('td', { class: 'num', text: st.tonight ? pct(st.newShare) : '—' }),
        h('td', { class: 'num', text: String(st.regulars) }));
    }));
  }
  const m = s.history.at(-1);
  if (m) {
    $('#mb-out').textContent = pct(m.outing);
    $('#mb-places').textContent = String(state.scenario.places.length);
    let ties = 0;
    for (let i = 0; i < s.n; i++) for (const [j, w] of s.ties[i]) if (j > i && w >= WEAK) ties++;
    $('#mb-ties').textContent = String(ties);
    $('#mb-alone').textContent = pct(m.isolated);
  }
}

function renderNotes(): void {
  const list = $('#notes');
  if (!state.notes.length) {
    list.replaceChildren(h('li', { class: 'empty-note', text: 'Notes appear as the evenings pass. Press Play.' }));
    return;
  }
  list.replaceChildren(...state.notes.slice(0, 14).map((n) => h('li', {}, h('span', { class: 'nd', text: `Ev. ${n.day}` }), n.text)));
}

function placeStats(p: Place): { regulars: number; tonight: number; newShare: number; open: boolean } {
  const s = state.sim;
  let regulars = 0;
  for (let i = 0; i < s.n; i++) if (s.favouriteOf(i) === p.id && (s.habit[i].get(p.id) ?? 0) > 3) regulars++;
  const nt = s.night.get(p.id);
  return { regulars, tonight: nt?.count ?? 0, newShare: nt && nt.count ? nt.newcomers / nt.count : 0, open: nt ? nt.open : true };
}

function renderInspector(): void {
  const box = $('#inspector');
  const sel = state.selected;
  const s = state.sim;
  if (!sel) { box.replaceChildren(); return; }
  if (sel.kind === 'place') {
    const p = state.scenario.places.find((x) => x.id === sel.id);
    if (!p) { state.selected = null; box.replaceChildren(); return; }
    const t = PLACE_TYPES[p.type];
    const st = placeStats(p);
    const name = h('input', { type: 'text', value: p.name, maxlength: 48, 'aria-label': 'Place name' });
    name.addEventListener('change', () => { p.name = name.value.trim() || t.label; placesChanged(); });
    const slider = (key: 'price' | 'capacity' | 'conviviality' | 'openness', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const out = h('output', { text: fmt(p[key]) });
      const input = h('input', { type: 'range', min, max, step, value: p[key], 'aria-label': `${label} of ${p.name}` });
      input.addEventListener('input', () => { p[key] = Number(input.value); out.textContent = fmt(p[key]); state.sim.setPlaces(state.scenario.places); state.dirty = true; });
      input.addEventListener('change', () => persist());
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, out), input);
    };
    const del = h('button', { class: 'btn btn-small', text: 'Remove this place' });
    del.addEventListener('click', () => removePlace(p.id));
    box.replaceChildren(h('div', { class: 'card' },
      h('p', { class: 'card-sub' }, `${t.label} · `, h('span', { lang: 'mr', text: t.deva })),
      h('div', { class: 'field' }, name),
      h('p', { class: 'small muted', text: t.blurb }),
      h('dl', {},
        h('dt', { text: 'Tonight' }), h('dd', { text: st.open ? `${st.tonight} / ${p.capacity}` : 'closed' }),
        h('dt', { text: 'Newcomers tonight' }), h('dd', { text: st.tonight ? pct(st.newShare) : '—' }),
        h('dt', { text: 'Regulars' }), h('dd', { text: String(st.regulars) })),
      slider('price', 'Price', 0, 1, 0.05, (v) => (v === 0 ? 'free' : pct(v))),
      slider('capacity', 'Capacity', 4, 120, 2, (v) => String(v)),
      slider('conviviality', 'Conviviality', 0, 1, 0.05, (v) => pct(v)),
      slider('openness', 'Open evenings', 0.1, 1, 0.05, (v) => pct(v)),
      h('div', { class: 'card-actions' }, del),
      h('p', { class: 'small muted', text: 'Drag it on the map, or focus the map and use the arrow keys.' })));
    return;
  }
  const i = sel.i;
  let strong = 0, weak = 0, cross = 0;
  for (const [j, w] of s.ties[i]) {
    if (w >= STRONG) strong++; else if (w >= WEAK) weak++;
    if (w >= WEAK && s.group[j] !== s.group[i]) cross++;
  }
  const fav = s.placeById(s.favouriteOf(i));
  const tonight = s.placeById(s.choice[i]);
  box.replaceChildren(h('div', { class: 'card' },
    h('p', { class: 'card-sub', text: `Synthetic person · Nº ${String(i + 1).padStart(3, '0')}` }),
    h('h4', { text: s.group[i] === 0 ? 'A long-time resident' : 'A newcomer' }),
    h('dl', {},
      h('dt', { text: 'Belonging' }), h('dd', { text: s.belongingOf(i).toFixed(2) }),
      h('dt', { text: 'Close ties' }), h('dd', { text: String(strong) }),
      h('dt', { text: 'Acquaintances' }), h('dd', { text: String(weak) }),
      h('dt', { text: 'Ties across groups' }), h('dd', { text: String(cross) }),
      h('dt', { text: 'Tonight' }), h('dd', { text: tonight ? tonight.name : 'at home' }),
      h('dt', { text: 'Regular at' }), h('dd', { text: fav ? fav.name : 'nowhere yet' }),
      h('dt', { text: 'Budget · sociability' }), h('dd', { text: `${s.budget[i].toFixed(2)} · ${s.soc[i].toFixed(2)}` })),
    h('p', { class: 'small muted', text: 'Lines on the map show this person’s ties; darker means closer.' })));
}

// ---------------------------------------------------------------- places
function addPlace(type: PlaceKey, x: number, y: number): void {
  const p = makePlace(type, x, y);
  state.scenario.places.push(p);
  state.selected = { kind: 'place', id: p.id };
  setTool('inspect');
  placesChanged();
}

function removePlace(id: number): void {
  state.scenario.places = state.scenario.places.filter((p) => p.id !== id);
  if (state.selected?.kind === 'place' && state.selected.id === id) state.selected = null;
  placesChanged();
}

// ---------------------------------------------------------------- pointer + keyboard
let drag: { id: number; moved: boolean } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus({ preventScroll: true });
  if (state.view === 'web') {
    const i = webView.pick(state.sim, e.clientX, e.clientY);
    state.selected = i >= 0 ? { kind: 'agent', i } : null;
    renderInspector();
    state.dirty = true;
    return;
  }
  const [x, y] = mapView.toWorld(e.clientX, e.clientY);
  const hit = mapView.pick(state.sim, x, y, displayT());
  if (PLACE_KEYS.includes(state.tool as PlaceKey)) {
    addPlace(state.tool as PlaceKey, x, y);
    return;
  }
  if (state.tool === 'remove') {
    if (hit?.kind === 'place') removePlace(hit.id);
    return;
  }
  state.selected = hit;
  renderLedger();
  if (hit?.kind === 'place') {
    drag = { id: hit.id, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
  renderInspector();
  state.dirty = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (state.view !== 'map') return;
  const [x, y] = mapView.toWorld(e.clientX, e.clientY);
  if (drag) {
    const p = state.scenario.places.find((q) => q.id === drag!.id);
    if (p) {
      const s = settle(x, y);
      p.x = Math.round(s.x);
      p.y = Math.round(s.y);
      drag.moved = true;
      state.sim.setPlaces(state.scenario.places);
      state.dirty = true;
    }
    return;
  }
  const hit = mapView.pick(state.sim, x, y, displayT());
  const same = JSON.stringify(hit) === JSON.stringify(state.hover);
  state.hover = hit;
  if (!same) { showTooltip(hit, e.clientX, e.clientY); state.dirty = true; }
  else if (hit) positionTooltip(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', () => {
  if (drag?.moved) { persist(); renderInspector(); }
  drag = null;
});
canvas.addEventListener('pointerleave', () => { state.hover = null; $('#tooltip').hidden = true; state.dirty = true; });

function showTooltip(hit: Pick, cx: number, cy: number): void {
  const tip = $('#tooltip');
  if (!hit) { tip.hidden = true; return; }
  const s = state.sim;
  if (hit.kind === 'place') {
    const p = s.placeById(hit.id)!;
    const nt = s.night.get(p.id);
    tip.replaceChildren(h('strong', { text: p.name }), nt && !nt.open ? 'Closed tonight' : `${nt?.count ?? 0} here tonight · capacity ${p.capacity}`);
  } else {
    tip.replaceChildren(h('strong', { text: s.group[hit.i] === 0 ? 'Long-time resident' : 'Newcomer' }), `Belonging ${s.belongingOf(hit.i).toFixed(2)} · click for detail`);
  }
  tip.hidden = false;
  positionTooltip(cx, cy);
}

function positionTooltip(cx: number, cy: number): void {
  const r = wrap.getBoundingClientRect();
  const tip = $('#tooltip');
  const x = Math.min(r.width - 120, Math.max(120, cx - r.left));
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.max(60, cy - r.top)}px`;
}

canvas.addEventListener('keydown', (e) => {
  const places = state.scenario.places;
  if (e.key === '[' || e.key === ']') {
    if (!places.length) return;
    const cur = state.selected?.kind === 'place' ? places.findIndex((p) => p.id === (state.selected as { id: number }).id) : -1;
    const next = (cur + (e.key === ']' ? 1 : -1) + places.length) % places.length;
    state.selected = { kind: 'place', id: places[next].id };
    renderInspector();
    state.dirty = true;
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter' && PLACE_KEYS.includes(state.tool as PlaceKey)) {
    addPlace(state.tool as PlaceKey, 500, 300);
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') { state.selected = null; setTool('inspect'); renderInspector(); state.dirty = true; return; }
  const sel = state.selected;
  if (sel?.kind !== 'place') return;
  const p = places.find((q) => q.id === sel.id);
  if (!p) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { removePlace(p.id); e.preventDefault(); return; }
  const step = e.shiftKey ? 20 : 5;
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (d[e.key]) {
    const s = settle(p.x + d[e.key][0], p.y + d[e.key][1]);
    p.x = Math.round(s.x); p.y = Math.round(s.y);
    placesChanged();
    e.preventDefault();
  }
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.key === ' ' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) {
    setPlaying(!state.playing);
    e.preventDefault();
  }
});

// ---------------------------------------------------------------- controls
function bindControls(): void {
  $('#play').addEventListener('click', () => setPlaying(!state.playing));
  $('#play-overlay').addEventListener('click', () => setPlaying(!state.playing));
  $('#step').addEventListener('click', () => { advance(1); state.t = 0.5; });
  $('#skip').addEventListener('click', () => advance(10));
  $('#reset').addEventListener('click', () => rebuild());
  $('#pace').addEventListener('input', (e) => {
    state.settings.secondsPerDay = Number((e.target as HTMLInputElement).value);
    $('#pace-out').textContent = `${state.settings.secondsPerDay}s`;
    store.saveSettings(state.settings);
  });
  $('#trails').addEventListener('change', (e) => {
    state.settings.trails = (e.target as HTMLInputElement).checked;
    if (!state.settings.trails) mapView.clearTrails();
    store.saveSettings(state.settings);
    state.dirty = true;
  });
  $('#preset').addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value as PresetKey;
    const seed = state.scenario.params.seed;
    state.scenario = presetScenario(key);
    state.scenario.params.seed = seed;
    persist();
    rebuild();
  });
  const seedInput = $('#seed') as HTMLInputElement;
  seedInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(999999, Math.round(Number(seedInput.value) || 1)));
    state.scenario.params.seed = v;
    persist();
    rebuild();
  });
  $('#reseed').addEventListener('click', () => {
    state.scenario.params.seed = 1 + Math.floor(Math.random() * 999998);
    persist();
    rebuild();
  });
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
  $('#tab-map').addEventListener('click', () => setView('map'));
  $('#tab-web').addEventListener('click', () => setView('web'));
  document.querySelector('.tabs')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const next = state.view === 'map' ? 'web' : 'map';
      setView(next);
      $(`#tab-${next}`).focus();
    }
  });
  $('#save').addEventListener('click', () => {
    const input = $('#save-name') as HTMLInputElement;
    const name = input.value.trim() || `City ${new Date().toLocaleDateString()}`;
    state.scenario.name = name;
    store.saveNamed(structuredClone(state.scenario));
    persist();
    input.value = '';
    syncUI();
  });
  if (!store.available) $('#storage-note').hidden = false;
}

function renderSaved(): void {
  const list = $('#saved');
  const saved = store.listSaved();
  if (!saved.length) {
    list.replaceChildren(h('li', { class: 'small muted', text: 'No saved cities yet.' }));
    return;
  }
  list.replaceChildren(...saved.map((sc) => {
    const load = h('button', { class: 'load', text: sc.name, title: `Load “${sc.name}”` });
    load.addEventListener('click', () => {
      state.scenario = structuredClone(sc);
      syncPlaceIds(state.scenario.places);
      persist();
      rebuild();
    });
    const del = h('button', { class: 'del', 'aria-label': `Delete saved city ${sc.name}`, text: '×' });
    del.addEventListener('click', () => { store.deleteNamed(sc.name); renderSaved(); });
    return h('li', {}, load, del);
  }));
}

// ---------------------------------------------------------------- experiment
function describe(sc: Scenario): string {
  const p = sc.params;
  return `${sc.places.length} places · ${p.population} people · ${pct(p.newcomerShare)} newcomers · housing mix ${pct(p.residentialMix)} · homophily ${p.homophily.toFixed(1)} · seed ${p.seed}`;
}

function renderArms(): void {
  for (const side of ['a', 'b'] as const) {
    const sc = side === 'a' ? state.expA : state.expB;
    $(`#${side}-name`).textContent = sc ? sc.name : 'Not set';
    $(`#${side}-meta`).textContent = sc ? describe(sc) : side === 'a' ? 'The baseline city.' : 'The changed city.';
  }
  ($('#run') as HTMLButtonElement).disabled = !(state.expA && state.expB);
  if (state.expA && state.expB) $('#run-status').textContent = 'Ready. Each replicate runs A and B on the same seed.';
}

function deriveB(kind: string): void {
  if (!state.expA) state.expA = structuredClone({ ...state.scenario });
  const a = state.expA;
  const b: Scenario = structuredClone(a);
  switch (kind) {
    case 'close-busiest': {
      const probe = new Sim(a.params, a.places);
      for (let d = 0; d < 30; d++) probe.stepDay();
      let best: Place | null = null;
      let bc = -1;
      for (const p of a.places) {
        const r = probe.reputation.get(p.id)?.count ?? 0;
        if (r > bc) { bc = r; best = p; }
      }
      if (!best) { $('#run-status').textContent = 'A has no places to close.'; return; }
      b.places = b.places.filter((p) => p.id !== best!.id);
      b.name = `${a.name}, without ${best.name}`;
      break;
    }
    case 'halve-prices':
      b.places.forEach((p) => (p.price = p.price / 2));
      b.name = `${a.name}, prices halved`;
      break;
    case 'central-katta': {
      syncPlaceIds([...a.places]);
      b.places.push(makePlace('katta', 505, 268, 'New katta at the crossing'));
      b.name = `${a.name}, plus a central katta`;
      break;
    }
    case 'mix-housing':
      b.params.residentialMix = 1;
      b.name = `${a.name}, mixed housing`;
      break;
  }
  state.expB = b;
  renderArms();
}

let worker: Worker | null = null;

function runExp(): void {
  if (!state.expA || !state.expB) return;
  const reps = Number(($('#reps') as HTMLSelectElement).value);
  const days = Number(($('#days') as HTMLSelectElement).value);
  const job = { a: state.expA, b: state.expB, reps, days, seed: state.expA.params.seed };
  const run = $('#run') as HTMLButtonElement;
  const status = $('#run-status');
  const bar = $('#progress-bar');
  run.disabled = true;
  status.textContent = `Running ${reps * 2} simulated cities × ${days} evenings…`;
  bar.style.width = '0%';
  $('#results').replaceChildren(h('p', { class: 'results-empty', text: 'Simulating… the city above keeps running while you wait.' }));
  const finish = (r: ExperimentResult) => {
    state.result = r;
    run.disabled = false;
    bar.style.width = '100%';
    status.textContent = `Done: ${reps} paired replicates, ${days} evenings each.`;
    ($('#csv') as HTMLButtonElement).disabled = false;
    renderResults();
  };
  const fallback = (why: string) => {
    status.textContent = `${why} Running on the main thread instead; the page may pause briefly.`;
    setTimeout(() => finish(runExperiment(job.a, job.b, reps, days, job.seed)), 30);
  };
  try {
    worker?.terminate();
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { bar.style.width = `${(m.done / m.total) * 100}%`; status.textContent = `Replicate ${m.done} of ${m.total}…`; }
      else if (m.type === 'done') finish(m.result);
      else if (m.type === 'error') fallback(`The worker failed (${m.message}).`);
    };
    worker.onerror = () => fallback('Background workers are unavailable.');
    worker.postMessage(job);
  } catch {
    fallback('Background workers are unavailable.');
  }
}

function renderResults(): void {
  const r = state.result;
  const box = $('#results');
  if (!r) {
    box.replaceChildren(h('p', { class: 'results-empty', text: 'No experiment yet. Try: A = “Peth evenings”, then “Close A’s busiest place”, then Run.' }));
    return;
  }
  const head = h('div', { class: 'res-row res-head' }, h('span', { text: 'Outcome' }), h('span', { class: 'res-strip', text: 'Each replicate · A · B' }), h('span', { text: 'B − A, 95% interval' }), h('span', { text: 'Reading' }));
  const rows = OUTCOMES.map((o) => {
    const c = compareOutcome(r, o.key);
    const clear = c.lo > 0 || c.hi < 0;
    const up = c.diff > 0;
    const good = o.better === 'none' ? null : (o.better === 'up') === up;
    const f = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(o.fmt)}`;
    const verdict = clear
      ? `B ${up ? 'raises' : 'lowers'} this by ${Math.abs(c.diff).toFixed(o.fmt)}; ${pct(up ? c.pPositive : 1 - c.pPositive)} of resamples agree.`
      : 'No clear difference at this many replicates.';
    return h('div', { class: 'res-row' },
      h('div', { class: 'res-label' }, o.label, h('small', { text: `A ${c.meanA.toFixed(o.fmt)} → B ${c.meanB.toFixed(o.fmt)}${o.better === 'up' ? ' · higher is better' : o.better === 'down' ? ' · lower is better' : ''}` })),
      h('div', { class: 'res-strip' }, stripPlot(r.a.map((s) => s[o.key]), r.b.map((s) => s[o.key]), `${o.label}: replicate values for A and B`)),
      h('div', {}, diffPlot(c, `${o.label}: difference ${f(c.diff)}, interval ${f(c.lo)} to ${f(c.hi)}`)),
      h('p', { class: `res-verdict ${clear && good !== null ? (good ? 'verdict-good' : 'verdict-bad') : ''}` },
        h('strong', { text: `${f(c.diff)} [${f(c.lo)}, ${f(c.hi)}]` }), h('br'), verdict));
  });
  box.replaceChildren(head, ...rows);
}

function bindExperiment(): void {
  $('#set-a').addEventListener('click', () => { state.expA = structuredClone(state.scenario); renderArms(); });
  $('#set-b').addEventListener('click', () => { state.expB = structuredClone(state.scenario); renderArms(); });
  document.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((b) => b.addEventListener('click', () => deriveB(b.dataset.variant!)));
  $('#run').addEventListener('click', runExp);
  $('#csv').addEventListener('click', () => { if (state.result) download('katta-experiment.csv', toCSV(state.result)); });
  renderArms();
  renderResults();
}

// ---------------------------------------------------------------- clock + loop
function displayT(): number {
  return reducedMotion.matches ? 0.5 : state.t;
}

function updateClock(t: number): void {
  // A crescent (chandrakor) that waxes through the evening.
  const phase = Math.min(0.98, Math.max(0.02, t));
  const rx = 11 * Math.abs(Math.cos(Math.PI * phase));
  const sweep = phase < 0.5 ? 0 : 1;
  $('#moon').setAttribute('d', `M20,9 A11,11 0 1,1 20,31 A${rx.toFixed(2)},11 0 1,${sweep} 20,9 Z`);
  $('#clock-label').textContent = t < 0.12 ? 'Dusk' : t < 0.38 ? 'Walking out' : t < 0.7 ? 'Evening' : t < 0.94 ? 'Walking home' : 'Night';
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.playing) {
    state.t += dt / state.settings.secondsPerDay;
    if (state.t >= 1) { state.t -= 1; advance(1); }
    state.dirty = true;
  }
  if (state.dirty || state.view === 'web') {
    const t = displayT();
    if (state.view === 'map') {
      mapView.render(state.sim, t, { trails: state.settings.trails && !reducedMotion.matches, selected: state.selected, hover: state.hover });
      updateClock(t);
    } else {
      webView.render(state.sim, state.selected?.kind === 'agent' ? state.selected.i : -1, state.playing);
    }
    state.dirty = false;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
buildLevers();
buildNotebook();
bindControls();
bindExperiment();
setTool('inspect');
mapView.onQualityDrop = () => { mapView.resize(state.scenario.params.form, state.sim); };
rebuild();
renderNotes();
new ResizeObserver(() => {
  if (state.view === 'map') mapView.resize(state.scenario.params.form, state.sim);
  else {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  state.dirty = true;
}).observe(wrap);
document.fonts?.ready.then(() => { mapView.resize(state.scenario.params.form, state.sim); state.dirty = true; });
if (!reducedMotion.matches && !window.location.hash) setPlaying(true);
requestAnimationFrame(frame);
