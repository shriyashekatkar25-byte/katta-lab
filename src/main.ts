/**
 * KATTA — application shell. Owns state, wires the controls, runs the animation
 * loop and talks to the experiment worker. All modelling lives in src/lib.
 */
import './styles.css';
import {
  DEFAULT_PARAMS, GROUPS, PLACE_SPECS, PLACE_TYPES, STRONG_TIE, belongingOf, createWorld, hasStrongTie,
  setPlot, step, type Params, type PlaceType, type World,
} from './lib/model';
import { OUTCOMES, OUTCOME_LABELS, runExperiment, type ExperimentResult, type Scenario } from './lib/experiment';
import { describeCity, describeExperiment, isImprovement, pct, pts, verdict } from './lib/report';
import {
  addNotebookEntry, loadNotebook, plotsFromTypes, readJSON, removeNotebookEntry, sanitizeCity, toCSV, writeJSON,
  type CityState, type NotebookEntry,
} from './lib/storage';
import { CityMap } from './ui/map';
import { dotStrip, isotype, sparkline } from './ui/charts';
import { glyphSVG } from './ui/glyphs';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const DAY_MS = 2600;

// ---------- state ----------
let city: CityState = sanitizeCity(readJSON('city', null));
let world: World = createWorld(city.params, plotsFromTypes(city.plotTypes), city.seed);
let baseline: { scenario: Scenario; label: string } = {
  scenario: { params: { ...DEFAULT_PARAMS }, plots: plotsFromTypes(sanitizeCity(null).plotTypes) },
  label: 'the default city',
};
const storedBaseline = readJSON<{ city: unknown; label: string } | null>('baseline', null);
if (storedBaseline) {
  const b = sanitizeCity(storedBaseline.city);
  baseline = { scenario: { params: b.params, plots: plotsFromTypes(b.plotTypes) }, label: String(storedBaseline.label || 'your frozen city') };
}
let lastResult: { result: ExperimentResult; changes: string[] } | null = null;
let playing = false;
let speed = 1;
let t = 0;
let lastFrame = performance.now();
let selectedAgent = -1;
let selectedPlot = -1;
let map: CityMap | null = null;

// ---------- helpers ----------
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => el.classList.remove('show'), 2600);
}

let saveTimer = 0;
function persistCity() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    city.params = { ...world.params };
    city.plotTypes = world.plots.map((p) => p.type);
    writeJSON('city', city);
  }, 250);
}

function rebuildWorld(seed = city.seed) {
  city.seed = seed;
  world = createWorld(world.params, world.plots, seed);
  map?.setWorld(world);
  selectedAgent = -1;
  if (map) map.selectedAgent = -1;
  t = 0;
  persistCity();
  refreshAll();
}

function advance() {
  step(world);
  map?.newEvening();
  refreshTonight();
  refreshLedger();
  refreshNotes();
  refreshInspector();
}

// ---------- map ----------
function initMap() {
  const canvas = $<HTMLCanvasElement>('map');
  try {
    map = new CityMap(canvas, {
      reducedMotion: reducedMotionQuery.matches,
      bridges: $<HTMLInputElement>('bridges').checked,
      trails: $<HTMLInputElement>('trails').checked,
    });
  } catch (err) {
    const st = $('mapState');
    st.hidden = false;
    st.textContent = `The map could not start (${String(err)}). The ledger, experiments and notes still work.`;
    return;
  }
  map.resize();
  map.setWorld(world);
  new ResizeObserver(() => map?.resize()).observe(canvas.parentElement!);

  canvas.addEventListener('pointermove', (e) => {
    if (!map) return;
    const p = map.pick(e.clientX, e.clientY, t);
    map.hoverPlot = p?.kind === 'plot' ? p.id : -1;
    canvas.style.cursor = p ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => map && (map.hoverPlot = -1));
  canvas.addEventListener('click', (e) => {
    if (!map) return;
    const p = map.pick(e.clientX, e.clientY, t);
    if (!p) {
      selectPlot(-1);
      selectAgent(-1);
      return;
    }
    if (p.kind === 'plot') {
      selectAgent(-1);
      selectPlot(p.id);
      const sel = document.querySelector<HTMLSelectElement>(`#plot-${p.id} select`);
      sel?.focus({ preventScroll: true });
    } else {
      selectPlot(-1);
      selectAgent(p.id);
    }
  });
}

function selectPlot(id: number) {
  selectedPlot = id;
  if (map) map.selectedPlot = id;
  document.querySelectorAll('.plot-row').forEach((r) => r.classList.toggle('sel', r.id === `plot-${id}`));
  refreshInspector();
}
function selectAgent(id: number) {
  selectedAgent = id;
  if (map) map.selectedAgent = id;
  refreshInspector();
}

function loop(now: number) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (playing) {
    const dur = reducedMotionQuery.matches ? DAY_MS * 1.5 : DAY_MS;
    t += (dt / dur) * speed;
    if (t >= 1) {
      t = 0;
      advance();
    }
  }
  map?.render(t, now);
  requestAnimationFrame(loop);
}

// ---------- controls ----------
function setPlaying(on: boolean) {
  playing = on;
  const b = $('play');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
  $('playLabel').textContent = on ? 'Pause' : 'Play';
}

interface SliderDef {
  key: keyof Params;
  label: string;
  min: number;
  max: number;
  step: number;
  rebuild?: boolean;
  fmt?: (v: number) => string;
  hint: string;
}
const SLIDERS: SliderDef[] = [
  { key: 'homophily', label: 'Homophily', min: 0, max: 3, step: 0.1, hint: 'pull toward rooms full of your own cohort' },
  { key: 'distance', label: 'Distance', min: 0, max: 5, step: 0.1, hint: 'reluctance to travel' },
  { key: 'price', label: 'Price', min: 0, max: 4, step: 0.1, hint: 'sensitivity to cost' },
  { key: 'familiarity', label: 'Habit', min: 0, max: 2, step: 0.1, hint: 'going back to your usual place' },
  { key: 'crowding', label: 'Crowding', min: 0, max: 4, step: 0.1, hint: 'dislike of over-full rooms' },
  { key: 'temperature', label: 'Whim', min: 0.1, max: 2, step: 0.05, hint: 'randomness of choice (logit temperature)' },
  { key: 'tieDecay', label: 'Forgetting', min: 0.01, max: 0.2, step: 0.01, fmt: (v) => `${(v * 100).toFixed(0)}%/day`, hint: 'how fast unrenewed ties fade' },
  { key: 'newcomerShare', label: 'Newcomers', min: 0.1, max: 0.9, step: 0.05, rebuild: true, fmt: (v) => pct(v), hint: 'share of the population' },
  { key: 'residentialMix', label: 'Mixed housing', min: 0, max: 1, step: 0.05, rebuild: true, hint: '0 = each cohort on its own bank' },
  { key: 'population', label: 'Population', min: 120, max: 600, step: 20, rebuild: true, fmt: (v) => v.toFixed(0), hint: 'residents simulated' },
];

function buildSliders() {
  const host = $('sliders');
  host.innerHTML = SLIDERS.map((s) => {
    const v = world.params[s.key] as number;
    return `<label class="slider" for="sl-${s.key}">
      <span class="sl-top"><span class="sl-name">${s.label}${s.rebuild ? ' <span class="rebuild-mark" title="Rebuilds the population">⟲</span>' : ''}</span><output id="out-${s.key}">${(s.fmt ?? ((x: number) => x.toFixed(2)))(v)}</output></span>
      <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-describedby="hint-${s.key}" />
      <span class="sl-hint" id="hint-${s.key}">${s.hint}</span>
    </label>`;
  }).join('') + `<button class="btn btn-ghost small-btn" id="resetParams">Restore default weights</button>`;
  for (const s of SLIDERS) {
    const input = $<HTMLInputElement>(`sl-${s.key}`);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      ($(`out-${s.key}`) as HTMLOutputElement).textContent = (s.fmt ?? ((x: number) => x.toFixed(2)))(v);
      (world.params as unknown as Record<string, number>)[s.key] = v;
      if (!s.rebuild) {
        persistCity();
        refreshDiff();
      }
    });
    input.addEventListener('change', () => {
      if (s.rebuild) {
        rebuildWorld();
        toast('Population rebuilt with the same seed.');
      }
    });
  }
  $('resetParams').addEventListener('click', () => {
    const monsoon = world.params.monsoon;
    world.params = { ...DEFAULT_PARAMS, monsoon };
    buildSliders();
    rebuildWorld();
    toast('Default weights restored.');
  });
}

function plotRow(id: number): string {
  const p = world.plots[id];
  const options = [`<option value="">Empty plot</option>`, ...PLACE_TYPES.map((k) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${PLACE_SPECS[k].name}</option>`)].join('');
  return `<span class="pl-glyph">${glyphSVG(p.type, 22)}</span>
    <span class="pl-name"><b>${esc(p.name)}</b><small>${p.type ? `${PLACE_SPECS[p.type].deva} · ${PLACE_SPECS[p.type].name.toLowerCase()}` : 'open land'}</small></span>
    <span class="pl-load" data-load="${id}"></span>
    <label class="sr-only" for="sel-${id}">Use of ${esc(p.name)}</label>
    <select id="sel-${id}" data-plot="${id}">${options}</select>`;
}

function buildPlots() {
  const list = $('plotList');
  list.innerHTML = world.plots.map((p) => `<li class="plot-row${p.type ? '' : ' empty'}" id="plot-${p.id}">${plotRow(p.id)}</li>`).join('');
  list.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.dataset.plot) return;
    const id = Number(sel.dataset.plot);
    const type = (sel.value || null) as PlaceType | null;
    setPlot(world, id, type);
    const li = $(`plot-${id}`);
    li.innerHTML = plotRow(id);
    li.classList.toggle('empty', !type);
    persistCity();
    refreshDiff();
    selectPlot(id);
    $<HTMLSelectElement>(`sel-${id}`).focus();
    toast(type ? `${PLACE_SPECS[type].name} opened at ${world.plots[id].name}.` : `${world.plots[id].name} closed.`);
  });
  list.addEventListener('focusin', (e) => {
    const sel = e.target as HTMLElement;
    if (sel.dataset.plot) selectPlot(Number(sel.dataset.plot));
  });
}

// ---------- panels ----------
function refreshTonight() {
  const m = world.history[world.history.length - 1];
  $('tDay').textContent = String(world.day);
  if (!m) {
    $('tSummary').textContent = 'The city is waiting for its first evening.';
    $('mapCaption').textContent = 'Evening 0 · before the first evening';
  } else {
    const out = Math.round(m.outRate * world.agents.length);
    $('tSummary').innerHTML = `${m.rain ? '<b class="rain">Rain.</b> ' : 'A dry evening. '}${out} of ${world.agents.length} residents went out. ${pct(m.dissimilarity)} of one cohort would have to move for the rooms to look alike.`;
    $('mapCaption').textContent = `Evening ${world.day} · ${m.rain ? 'rain' : 'dry'} · ${out} out`;
  }
  $('quality').textContent = map ? map.qualityLabel : 'unavailable';
  // Loads in plot list.
  const counts = new Array(world.plots.length).fill(0);
  for (let i = 0; i < world.attend.length; i++) if (world.attend[i] >= 0) counts[world.attend[i]]++;
  document.querySelectorAll<HTMLElement>('[data-load]').forEach((el) => {
    const id = Number(el.dataset.load);
    const p = world.plots[id];
    el.textContent = p.type && world.day ? String(counts[id]) : '';
    el.classList.toggle('over', !!p.type && counts[id] > PLACE_SPECS[p.type].capacity);
    el.title = p.type ? `${counts[id]} visitors tonight, capacity ${PLACE_SPECS[p.type].capacity}` : '';
  });
}

function refreshInspector() {
  const host = $('inspector');
  if (selectedAgent >= 0 && world.agents[selectedAgent]) {
    const a = world.agents[selectedAgent];
    const g = GROUPS[a.group];
    const ties = [...a.ties.entries()].sort((p, q) => q[1] - p[1]);
    const strong = ties.filter(([, v]) => v >= STRONG_TIE);
    const cross = strong.filter(([k]) => world.agents[k].group !== a.group).length;
    const habit = [...a.fam].map((v, j) => ({ v, j })).filter((x) => x.v > 0.5 && world.plots[x.j].type).sort((p, q) => q.v - p.v).slice(0, 3);
    const tonight = world.attend[a.id];
    host.innerHTML = `<h3>Resident #${a.id} <small class="c-${a.group ? 'new' : 'settled'}">${g.name} · <span lang="mr">${g.deva}</span></small></h3>
      <dl class="kv">
        <dt>Tonight</dt><dd>${tonight >= 0 ? esc(world.plots[tonight].name) : 'stayed home'}</dd>
        <dt>Belonging</dt><dd>${pct(belongingOf(a))}</dd>
        <dt>Ties</dt><dd>${ties.length} (${strong.length} strong, ${cross} across cohorts)</dd>
        <dt>Budget · sociability</dt><dd>${a.budget.toFixed(2)} · ${a.sociability.toFixed(2)}</dd>
        <dt>Regular at</dt><dd>${habit.length ? habit.map((h) => esc(world.plots[h.j].name)).join(', ') : 'nowhere yet'}</dd>
      </dl>
      <p class="muted small">A synthetic person. Lines on the map show their ten strongest ties.</p>`;
    return;
  }
  if (selectedPlot >= 0) {
    const p = world.plots[selectedPlot];
    if (!p.type) {
      host.innerHTML = `<h3>${esc(p.name)} <small>open land</small></h3><p>An empty plot. Choose a use for it in the plot ledger below to open a new place here from the next evening.</p>`;
      return;
    }
    const s = PLACE_SPECS[p.type];
    const m = world.history[world.history.length - 1];
    const a = m ? m.load[0][p.id] : 0;
    const b = m ? m.load[1][p.id] : 0;
    const total = a + b;
    host.innerHTML = `<h3>${esc(p.name)} <small>${s.name} · <span lang="mr">${s.deva}</span></small></h3>
      <p>${s.blurb}</p>
      <div class="split" role="img" aria-label="${a} settled and ${b} newcomers tonight">
        <span class="split-a" style="flex:${a || 0.0001}"></span><span class="split-b" style="flex:${b || 0.0001}"></span>
      </div>
      <dl class="kv">
        <dt>Tonight</dt><dd>${total} visitors (${a} settled, ${b} newcomers)${total > s.capacity ? ' · <b class="warn">over capacity</b>' : ''}</dd>
        <dt>Capacity · price</dt><dd>${s.capacity} · ${s.cost === 0 ? 'free' : pct(s.cost) + ' of a budget'}</dd>
        <dt>Talk</dt><dd>${s.talk} conversation${s.talk > 1 ? 's' : ''} per visitor${s.outdoor ? ' · outdoors' : ' · indoors'}</dd>
      </dl>`;
    return;
  }
  host.innerHTML = `<h3>Inspector</h3><p class="muted">Select a place on the map or in the plot ledger, or click a resident.</p>`;
}

function refreshLedger() {
  const H = world.history;
  const rain = H.map((m) => m.rain);
  const last = H[H.length - 1];
  const host = $('metrics');
  host.innerHTML = OUTCOMES.map((k) => {
    const meta = OUTCOME_LABELS[k];
    const vals = H.map((m) => m[k] as number);
    const v = last ? (last[k] as number) : NaN;
    const big = Number.isNaN(v) ? '—' : meta.pct ? `${(v * 100).toFixed(0)}<small>%</small>` : v.toFixed(2);
    const max = k === 'mixing' ? Math.max(1, ...vals) : 1;
    return `<article class="metric"><h3>${meta.label}</h3><p class="big">${big}</p>${sparkline(vals, rain, { max, label: meta.label })}<p class="m-note">${meta.better === 'up' ? 'higher is better' : 'lower is better'}</p></article>`;
  }).join('');
  $('census').innerHTML = isotype(world, (id) => belongingOf(world.agents[id]), (id) => hasStrongTie(world.agents[id]));
  if (last) {
    const [b0, b1] = last.belongingByGroup;
    $('censusNote').textContent = `Mean belonging: settled ${pct(b0)}, newcomers ${pct(b1)}. Evening ${world.day}.`;
  } else $('censusNote').textContent = 'No evenings yet: everyone starts with no ties.';
}

function refreshNotes() {
  const notes = describeCity(world.history, world.plots);
  $('fieldNotes').innerHTML = `<h3>The city tonight</h3>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}${lastResult ? `<h3>The last experiment</h3>${describeExperiment(lastResult.result, lastResult.changes).map((n) => `<p>${esc(n)}</p>`).join('')}` : ''}`;
}

// ---------- experiment ----------
function describeChanges(A: Scenario, B: Scenario): string[] {
  const out: string[] = [];
  A.plots.forEach((p, i) => {
    const q = B.plots[i];
    if (p.type === q.type) return;
    if (!p.type) out.push(`open a ${PLACE_SPECS[q.type!].name.toLowerCase()} at ${q.name}`);
    else if (!q.type) out.push(`close the ${PLACE_SPECS[p.type].name.toLowerCase()} at ${p.name}`);
    else out.push(`turn the ${PLACE_SPECS[p.type].name.toLowerCase()} at ${p.name} into a ${PLACE_SPECS[q.type].name.toLowerCase()}`);
  });
  for (const s of SLIDERS) {
    const a = A.params[s.key] as number;
    const b = B.params[s.key] as number;
    if (Math.abs(a - b) > 1e-9) out.push(`${s.label.toLowerCase()} ${(s.fmt ?? ((x: number) => x.toFixed(2)))(a)} → ${(s.fmt ?? ((x: number) => x.toFixed(2)))(b)}`);
  }
  if (A.params.monsoon !== B.params.monsoon) out.push(B.params.monsoon ? 'switch on the monsoon' : 'switch off the monsoon');
  return out;
}

function currentScenario(): Scenario {
  return { params: { ...world.params }, plots: world.plots.map((p) => ({ ...p })) };
}

function refreshDiff() {
  const changes = describeChanges(baseline.scenario, currentScenario());
  $('diffList').innerHTML = changes.length
    ? changes.map((c) => `<li>${esc(c)}</li>`).join('')
    : '<li class="muted">No differences from A yet. Running now is an A/A test: every interval should straddle zero.</li>';
  $('baselineNote').textContent = `Baseline A: ${baseline.label}.`;
}

let worker: Worker | null = null;
let jobId = 0;
function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

function runExperimentUI() {
  const runs = Number($<HTMLSelectElement>('runs').value);
  const days = Number($<HTMLSelectElement>('days').value);
  const A = baseline.scenario;
  const B = currentScenario();
  const changes = describeChanges(A, B);
  const baseSeed = (city.seed * 31 + 17) >>> 0;
  const btn = $<HTMLButtonElement>('runBtn');
  btn.disabled = true;
  $('progress').hidden = false;
  const setProgress = (done: number, total: number) => {
    $('progressBar').style.width = `${(done / total) * 100}%`;
    $('progressText').textContent = `${done} of ${total} paired worlds`;
  };
  setProgress(0, runs);
  const finish = (result: ExperimentResult | null, error?: string) => {
    btn.disabled = false;
    $('progress').hidden = true;
    if (!result) {
      $('results').innerHTML = `<div class="empty-state error"><p class="empty-title">The experiment failed.</p><p>${esc(error ?? 'Unknown error')}</p></div>`;
      return;
    }
    lastResult = { result, changes };
    renderResults(result, changes);
    refreshNotes();
    $<HTMLButtonElement>('saveExp').disabled = false;
    $<HTMLButtonElement>('exportJson').disabled = false;
  };
  const w = getWorker();
  if (w) {
    const id = ++jobId;
    w.onmessage = (e) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.type === 'progress') setProgress(d.done, d.total);
      else if (d.type === 'done') finish(d.result);
      else if (d.type === 'error') finish(null, d.message);
    };
    w.onerror = (e) => finish(null, e.message || 'The worker stopped.');
    w.postMessage({ id, A, B, runs, days, baseSeed });
  } else {
    // Fallback: run on the main thread after a paint.
    setTimeout(() => {
      try {
        finish(runExperiment(A, B, runs, days, baseSeed));
      } catch (err) {
        finish(null, String(err));
      }
    }, 30);
  }
}

function renderResults(r: ExperimentResult, changes: string[]) {
  const rows = OUTCOMES.map((k) => {
    const o = r.outcomes[k];
    const meta = OUTCOME_LABELS[k];
    const v = verdict(o.diff.lo, o.diff.hi);
    const good = isImprovement(k, v);
    const fmtV = (x: number) => (meta.pct ? pct(x, 1) : x.toFixed(3));
    const fmtD = (x: number) => (meta.pct ? pts(x) : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`);
    const chip = v === 'unclear' ? '<span class="chip">no clear change</span>' : `<span class="chip ${good ? 'good' : 'bad'}">${v === 'rise' ? 'rises' : 'falls'}</span>`;
    return `<article class="res-row">
      <header><h4>${meta.label}</h4>${chip}</header>
      <div class="res-body">
        ${dotStrip(o, { pct: meta.pct, label: meta.label })}
        <dl class="res-nums">
          <dt>A</dt><dd>${fmtV(o.a.mean)} <small>[${fmtV(o.a.lo)}, ${fmtV(o.a.hi)}]</small></dd>
          <dt>B</dt><dd>${fmtV(o.b.mean)} <small>[${fmtV(o.b.lo)}, ${fmtV(o.b.hi)}]</small></dd>
          <dt>Δ</dt><dd><b>${fmtD(o.diff.mean)}</b> <small>[${fmtD(o.diff.lo)}, ${fmtD(o.diff.hi)}] · d=${o.effect.toFixed(2)}</small></dd>
        </dl>
      </div>
    </article>`;
  }).join('');
  $('results').innerHTML = `<p class="res-meta">${r.runs} paired worlds × ${r.days} evenings · intervention: ${changes.length ? esc(changes.join('; ')) : 'none (A/A test)'} · synthetic</p>${rows}`;
}

// ---------- notebook ----------
function renderNotebook(list: NotebookEntry[] = loadNotebook()) {
  const host = $('notebook');
  if (!list.length) {
    host.innerHTML = '<li class="muted">Nothing saved yet. Run an experiment, then save it here.</li>';
    return;
  }
  host.innerHTML = list.map((e) => `<li class="nb-item">
    <div><b>${esc(e.title)}</b><small>${new Date(e.createdAt).toLocaleString()} · ${e.runs}×${e.days}</small>
    <p>${esc(e.note)}</p></div>
    <button class="btn btn-ghost small-btn" data-del="${esc(e.id)}" aria-label="Delete notebook entry ${esc(e.title)}">Delete</button></li>`).join('');
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function wireNotebook() {
  $('saveExp').addEventListener('click', () => {
    if (!lastResult) return;
    const { result, changes } = lastResult;
    const clear = OUTCOMES.filter((k) => verdict(result.outcomes[k].diff.lo, result.outcomes[k].diff.hi) !== 'unclear');
    const entry: NotebookEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: changes.length ? changes[0] + (changes.length > 1 ? ` (+${changes.length - 1})` : '') : 'A/A test',
      createdAt: new Date().toISOString(),
      note: clear.length ? `Clear movement in: ${clear.map((k) => OUTCOME_LABELS[k].label.toLowerCase()).join(', ')}.` : 'No outcome moved clearly.',
      rows: OUTCOMES.map((k) => ({ outcome: k, a: result.outcomes[k].a.mean, b: result.outcomes[k].b.mean, lo: result.outcomes[k].diff.lo, hi: result.outcomes[k].diff.hi })),
      runs: result.runs,
      days: result.days,
    };
    renderNotebook(addNotebookEntry(entry));
    toast('Saved to the notebook in this browser.');
  });
  $('notebook').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.del;
    if (id) renderNotebook(removeNotebookEntry(id));
  });
  $('exportCsv').addEventListener('click', () => {
    if (!world.history.length) {
      toast('No evenings to export yet.');
      return;
    }
    const rows = world.history.map((m) => ({
      day: m.day, rain: m.rain, out_rate: +m.outRate.toFixed(4), dissimilarity: +m.dissimilarity.toFixed(4),
      bridging: +m.bridging.toFixed(4), mixing: +m.mixing.toFixed(4), isolation: +m.isolation.toFixed(4),
      belonging: +m.belonging.toFixed(4), belonging_settled: +m.belongingByGroup[0].toFixed(4),
      belonging_newcomers: +m.belongingByGroup[1].toFixed(4), concentration: +m.concentration.toFixed(4), synthetic: true,
    }));
    download(`katta-ledger-seed${city.seed}.csv`, toCSV(rows), 'text/csv');
  });
  $('exportJson').addEventListener('click', () => {
    if (!lastResult) return;
    download('katta-experiment.json', JSON.stringify({ synthetic: true, ...lastResult, baseline: baseline.label }, null, 2), 'application/json');
  });
}

function refreshAll() {
  refreshTonight();
  refreshLedger();
  refreshNotes();
  refreshInspector();
  refreshDiff();
}

// ---------- boot ----------
function boot() {
  initMap();
  buildSliders();
  buildPlots();

  $<HTMLInputElement>('monsoon').checked = world.params.monsoon;
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('stepBtn').addEventListener('click', () => {
    t = 0;
    advance();
  });
  $('resetBtn').addEventListener('click', () => {
    rebuildWorld(Math.floor(Math.random() * 1e6));
    toast(`New city, seed ${city.seed}.`);
  });
  document.querySelectorAll<HTMLInputElement>('input[name=speed]').forEach((r) => r.addEventListener('change', () => (speed = Number(r.value))));
  $('monsoon').addEventListener('change', (e) => {
    world.params.monsoon = (e.target as HTMLInputElement).checked;
    persistCity();
    refreshDiff();
    toast(world.params.monsoon ? 'Monsoon: about six evenings in ten will be rainy.' : 'The rains have passed.');
  });
  $('bridges').addEventListener('change', (e) => {
    if (!map) return;
    map.options.bridges = (e.target as HTMLInputElement).checked;
    map.refreshBridges();
  });
  $('trails').addEventListener('change', (e) => map && (map.options.trails = (e.target as HTMLInputElement).checked));
  reducedMotionQuery.addEventListener?.('change', () => map && (map.options.reducedMotion = reducedMotionQuery.matches));

  $('freezeBtn').addEventListener('click', () => {
    baseline = { scenario: currentScenario(), label: `your city as frozen at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
    writeJSON('baseline', { city: { params: baseline.scenario.params, plotTypes: baseline.scenario.plots.map((p) => p.type), seed: city.seed }, label: baseline.label });
    refreshDiff();
    toast('Baseline A frozen. Now change something.');
  });
  $('runBtn').addEventListener('click', runExperimentUI);
  wireNotebook();
  renderNotebook();

  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
    if (e.key === ' ') {
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.key === 'n' || e.key === 'N') {
      t = 0;
      advance();
    } else if (e.key === 'Escape') {
      selectPlot(-1);
      selectAgent(-1);
    }
  });

  // Start with a fortnight already lived, so the ledger has something to say.
  for (let i = 0; i < 14; i++) step(world);
  map?.newEvening();
  refreshAll();
  if (!reducedMotionQuery.matches) setPlaying(true);
  requestAnimationFrame(loop);
}

boot();
