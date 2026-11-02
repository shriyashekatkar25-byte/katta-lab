/**
 * KATTA — the agent-based model.
 *
 * A synthetic city of residents in two cohorts (people long settled in the old
 * city, and people who arrived recently and mostly live across the river). Every
 * evening each resident decides whether to go out and, if so, which "third
 * place" to visit (Oldenburg's term for the informal public spaces between home
 * and work). Choice follows a multinomial-logit (random-utility) model. Inside a
 * place people strike up a few conversations with whoever happens to be there;
 * repeated conversations become ties, and ties fade without contact.
 *
 * Nothing here is calibrated to a real city or population. It is an
 * inspectable toy for asking "what if" questions, and is labelled as such
 * throughout the interface.
 */
import { mulberry32, normal, randInt, weightedIndex, type Rng } from './rng';
import { gini } from './stats';

export type PlaceType = 'tapri' | 'vachanalay' | 'ghat' | 'cinema' | 'cafe';
export type Group = 0 | 1;

export interface PlaceSpec {
  type: PlaceType;
  name: string;
  deva: string;
  /** Comfortable capacity; above it the crowding penalty applies. */
  capacity: number;
  /** Price as a share of a nominal evening budget, 0..1. */
  cost: number;
  /** Outdoor places lose appeal on rainy evenings. */
  outdoor: boolean;
  /** Baseline taste for each cohort [settled, newcomer]. A modelling assumption, editable in code. */
  appeal: [number, number];
  /** Conversations each visitor starts per evening (a quiet reading room is 1, a chai stall 3). */
  talk: number;
  blurb: string;
}

export const PLACE_SPECS: Record<PlaceType, PlaceSpec> = {
  tapri: {
    type: 'tapri', name: 'Chai tapri', deva: 'टपरी', capacity: 14, cost: 0.08, outdoor: true,
    appeal: [0.85, 0.6], talk: 3, blurb: 'A roadside tea stall. Cheap, small, loud, outdoors.',
  },
  vachanalay: {
    type: 'vachanalay', name: 'Vachanalay', deva: 'वाचनालय', capacity: 30, cost: 0, outdoor: false,
    appeal: [0.55, 0.6], talk: 1, blurb: 'A public reading room. Free, quiet, dry in the rain.',
  },
  ghat: {
    type: 'ghat', name: 'Riverside ghat', deva: 'घाट', capacity: 60, cost: 0, outdoor: true,
    appeal: [0.65, 0.6], talk: 2, blurb: 'Stone steps down to the river. Free, open, rain-exposed.',
  },
  cinema: {
    type: 'cinema', name: 'Single-screen', deva: 'चित्रपटगृह', capacity: 80, cost: 0.45, outdoor: false,
    appeal: [0.7, 0.6], talk: 1, blurb: 'An old single-screen theatre. Big, dark, talk only at the interval.',
  },
  cafe: {
    type: 'cafe', name: 'Café', deva: 'कॅफे', capacity: 24, cost: 0.7, outdoor: false,
    appeal: [0.45, 0.8], talk: 3, blurb: 'A new café. Pricier, cosy, built for lingering.',
  },
};
export const PLACE_TYPES = Object.keys(PLACE_SPECS) as PlaceType[];

export const GROUPS = [
  { key: 'settled', name: 'Settled', deva: 'जुने', note: 'long-time residents, mostly old city' },
  { key: 'newcomer', name: 'Newcomers', deva: 'नवीन', note: 'recent arrivals, mostly across the river' },
] as const;

/** City canvas in model units. */
export const CITY_W = 1000;
export const CITY_H = 640;
const DIAG = Math.hypot(CITY_W, CITY_H);

/** The river (fictional), as a polyline in model units. */
export const RIVER: [number, number][] = [
  [470, -20], [455, 80], [430, 170], [450, 260], [500, 330], [520, 420], [490, 520], [505, 660],
];

export interface Neighbourhood {
  name: string;
  x: number;
  y: number;
  side: 0 | 1;
}
export const NEIGHBOURHOODS: Neighbourhood[] = [
  { name: 'Juni Peth', x: 200, y: 170, side: 0 },
  { name: 'Kumbharwada', x: 150, y: 430, side: 0 },
  { name: 'Deul Ali', x: 320, y: 300, side: 0 },
  { name: 'Tekdi Nagar', x: 720, y: 150, side: 1 },
  { name: 'Station Colony', x: 840, y: 400, side: 1 },
  { name: 'Navi Vasahat', x: 650, y: 520, side: 1 },
];

export interface Plot {
  id: number;
  name: string;
  x: number;
  y: number;
  type: PlaceType | null;
}

/** Sixteen plots. The default city occupies nine; the rest are open for interventions. */
export function defaultPlots(): Plot[] {
  const raw: [string, number, number, PlaceType | null][] = [
    ['Kalbhairav Chowk', 230, 230, 'tapri'],
    ['Gurav Lane', 120, 330, 'tapri'],
    ['Deul Steps', 395, 360, 'ghat'],
    ['Tilak Hall', 300, 120, 'vachanalay'],
    ['Prabhat Talkies', 250, 470, 'cinema'],
    ['Bus Depot Corner', 360, 540, 'tapri'],
    ['Tekdi Gate', 640, 230, 'cafe'],
    ['Station Arcade', 800, 300, 'cafe'],
    ['Pipal Tree', 760, 520, 'tapri'],
    ['Old Mill Yard', 560, 400, null],
    ['Ferry Landing', 560, 280, null],
    ['Ghat No. 2', 455, 470, null],
    ['Market Bridge', 470, 200, null],
    ['Lake Edge', 880, 160, null],
    ['Ward Office', 160, 560, null],
    ['Water Tank', 900, 560, null],
  ];
  return raw.map(([name, x, y, type], id) => ({ id, name, x, y, type }));
}

export interface Params {
  population: number;
  /** Share of residents who are newcomers. */
  newcomerShare: number;
  /** 0 = every cohort lives on "its" side of the river; 1 = homes are spread at random. */
  residentialMix: number;
  /** β weights of the choice model. */
  homophily: number;
  distance: number;
  price: number;
  familiarity: number;
  crowding: number;
  /** Logit temperature: higher = noisier, less "rational" choices. */
  temperature: number;
  /** Daily fade of tie strength (0..1). */
  tieDecay: number;
  /** Monsoon season: ~60% of evenings are rainy. */
  monsoon: boolean;
}

export const DEFAULT_PARAMS: Params = {
  population: 360,
  newcomerShare: 0.4,
  residentialMix: 0.35,
  homophily: 0.5,
  distance: 1.4,
  price: 1.6,
  familiarity: 0.8,
  crowding: 1.5,
  temperature: 0.6,
  tieDecay: 0.06,
  monsoon: false,
};

export interface Agent {
  id: number;
  group: Group;
  x: number;
  y: number;
  /** Nominal evening budget, 0..1. Same distribution for both cohorts on purpose. */
  budget: number;
  /** Probability of going out on a dry evening. */
  sociability: number;
  /** Habit: decayed visit counts per plot. */
  fam: Float32Array;
  /** Tie strengths to other residents (symmetric, sparse). */
  ties: Map<number, number>;
}

export interface DayMetrics {
  day: number;
  rain: boolean;
  outRate: number;
  /** Duncan dissimilarity of the two cohorts across places tonight. */
  dissimilarity: number;
  /** Share of strong ties that cross cohorts. */
  bridging: number;
  /** Bridging divided by its expected value under random mixing (1 = colour-blind mixing). */
  mixing: number;
  /** Share of residents with no strong tie. */
  isolation: number;
  belonging: number;
  belongingByGroup: [number, number];
  /** Gini of attendance across open places. */
  concentration: number;
  /** Visitors per plot tonight, split by cohort. */
  load: [number[], number[]];
}

export interface World {
  params: Params;
  plots: Plot[];
  agents: Agent[];
  day: number;
  rng: Rng;
  rain: boolean;
  /** Where everyone went last evening (-1 = stayed home). */
  attend: Int16Array;
  /** Pairs who spoke last evening (capped sample for drawing). */
  conversations: [number, number][];
  history: DayMetrics[];
  /** Yesterday's composition per plot, used by the homophily term. */
  prevShare: [Float32Array, Float32Array];
  prevLoad: Float32Array;
}

export const STRONG_TIE = 2.5;
const TIE_FLOOR = 0.1;
const HABIT_FADE = 0.96;

export function createWorld(params: Params, plots: Plot[], seed: number): World {
  const rng = mulberry32(seed);
  const n = Math.max(20, Math.round(params.population));
  const agents: Agent[] = [];
  const nNew = Math.round(n * params.newcomerShare);
  for (let id = 0; id < n; id++) {
    const group: Group = id < nNew ? 1 : 0;
    // Pick the side of the river: own side unless the residential mix says otherwise.
    const ownSide = rng() >= params.residentialMix / 2;
    const side = ownSide ? (group === 1 ? 1 : 0) : group === 1 ? 0 : 1;
    const hoods = NEIGHBOURHOODS.filter((h) => h.side === side);
    const h = hoods[randInt(rng, hoods.length)];
    const x = clamp(normal(rng, h.x, 60), 20, CITY_W - 20);
    const y = clamp(normal(rng, h.y, 55), 20, CITY_H - 20);
    agents.push({
      id,
      group,
      x,
      y,
      budget: clamp(0.15 + 0.85 * rng(), 0, 1),
      sociability: clamp(normal(rng, 0.62, 0.16), 0.15, 0.95),
      fam: new Float32Array(plots.length),
      ties: new Map(),
    });
  }
  const p = plots.length;
  return {
    params: { ...params },
    plots: plots.map((q) => ({ ...q })),
    agents,
    day: 0,
    rng,
    rain: false,
    attend: new Int16Array(n).fill(-1),
    conversations: [],
    history: [],
    prevShare: [new Float32Array(p).fill(0.5), new Float32Array(p).fill(0.5)],
    prevLoad: new Float32Array(p),
  };
}

/**
 * Utility of plot j for agent a (random-utility model; the logit adds Gumbel noise).
 *
 *   U = 2.2·appeal_g − β_d·3·dist/diag − β_p·cost·(1.2 − budget) + β_f·0.6·ln(1+habit)
 *       + β_h·2·(sameShare − ½) − β_c·max(0, load/capacity − 1) − 2.5·[rain ∧ outdoor]
 */
export function utility(w: World, a: Agent, j: number): number {
  const plot = w.plots[j];
  if (!plot.type) return -Infinity;
  const s = PLACE_SPECS[plot.type];
  const P = w.params;
  const dist = Math.hypot(a.x - plot.x, a.y - plot.y) / DIAG;
  const same = w.prevShare[a.group][j];
  let u = 2.2 * s.appeal[a.group];
  u -= P.distance * 3 * dist;
  u -= P.price * s.cost * (1.2 - a.budget);
  u += P.familiarity * 0.6 * Math.log1p(a.fam[j]);
  u += P.homophily * 2 * (same - 0.5);
  u -= P.crowding * Math.max(0, w.prevLoad[j] / s.capacity - 1);
  if (w.rain && s.outdoor) u -= 2.5;
  return u;
}

/** Utility of staying home, the outside option of the logit. */
export const HOME_UTILITY = 0.4;

/** Choice probabilities over [home, plot0, plot1, ...] for one agent (softmax / temperature). */
export function choiceProbabilities(w: World, a: Agent): Float64Array {
  const T = Math.max(0.05, w.params.temperature);
  const out = new Float64Array(w.plots.length + 1);
  const us: number[] = [HOME_UTILITY];
  for (let j = 0; j < w.plots.length; j++) us.push(utility(w, a, j));
  const max = Math.max(...us);
  let total = 0;
  for (let k = 0; k < us.length; k++) {
    const e = Number.isFinite(us[k]) ? Math.exp((us[k] - max) / T) : 0;
    out[k] = e;
    total += e;
  }
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

function addTie(agents: Agent[], i: number, j: number, amount: number) {
  const a = agents[i];
  const b = agents[j];
  a.ties.set(j, (a.ties.get(j) ?? 0) + amount);
  b.ties.set(i, (b.ties.get(i) ?? 0) + amount);
}

/** Advance the world by one evening. Mutates and returns the day's metrics. */
export function step(w: World): DayMetrics {
  const { agents, plots, rng, params } = w;
  const n = agents.length;
  const p = plots.length;
  w.day += 1;
  w.rain = params.monsoon ? rng() < 0.6 : false;

  // 1. Ties fade.
  const keep = 1 - params.tieDecay;
  for (const a of agents) {
    for (const [k, v] of a.ties) {
      const nv = v * keep;
      if (nv < TIE_FLOOR) a.ties.delete(k);
      else a.ties.set(k, nv);
    }
  }

  // 2. Each resident decides.
  const attend = new Int16Array(n).fill(-1);
  const rooms: number[][] = Array.from({ length: p }, () => []);
  for (const a of agents) {
    const goOut = rng() < a.sociability * (w.rain ? 0.7 : 1);
    if (goOut) {
      const probs = choiceProbabilities(w, a);
      const k = weightedIndex(rng, probs);
      if (k > 0) {
        attend[a.id] = k - 1;
        rooms[k - 1].push(a.id);
      }
    }
    for (let j = 0; j < p; j++) a.fam[j] *= HABIT_FADE;
    if (attend[a.id] >= 0) a.fam[attend[a.id]] += 1;
  }

  // 3. Conversations: each visitor starts `talk` conversations with random co-present people.
  const conv: [number, number][] = [];
  for (let j = 0; j < p; j++) {
    const room = rooms[j];
    const type = plots[j].type;
    if (!type || room.length < 2) continue;
    const talk = PLACE_SPECS[type].talk;
    // Partners are drawn from whoever is present, with a mild pull towards people you
    // already know (a two-candidate tournament won by the stronger tie 60% of the time).
    // Crowded rooms dilute conversation: you are less likely to meet the same person twice.
    for (const i of room) {
      const me = agents[i];
      for (let t = 0; t < talk; t++) {
        let other = room[randInt(rng, room.length)];
        const alt = room[randInt(rng, room.length)];
        if ((me.ties.get(alt) ?? 0) > (me.ties.get(other) ?? 0) && rng() < 0.6) other = alt;
        if (other === i) continue;
        addTie(agents, i, other, 1);
        if (conv.length < 600) conv.push([i, other]);
      }
    }
  }

  // 4. Remember tonight's composition for tomorrow's homophily and crowding terms.
  for (let j = 0; j < p; j++) {
    const room = rooms[j];
    w.prevLoad[j] = room.length;
    if (room.length === 0) {
      w.prevShare[0][j] = 0.5;
      w.prevShare[1][j] = 0.5;
    } else {
      let g1 = 0;
      for (const i of room) g1 += agents[i].group;
      w.prevShare[1][j] = g1 / room.length;
      w.prevShare[0][j] = 1 - g1 / room.length;
    }
  }

  w.attend = attend;
  w.conversations = conv;
  const m = computeMetrics(w);
  w.history.push(m);
  return m;
}

/** Population metrics for the current state. Pure with respect to the world. */
export function computeMetrics(w: World): DayMetrics {
  const { agents, plots, attend } = w;
  const n = agents.length;
  const p = plots.length;
  const load: [number[], number[]] = [new Array(p).fill(0), new Array(p).fill(0)];
  let out = 0;
  for (const a of agents) {
    const j = attend[a.id];
    if (j >= 0) {
      load[a.group][j] += 1;
      out++;
    }
  }
  // Dissimilarity across open places.
  let A = 0;
  let B = 0;
  for (let j = 0; j < p; j++) {
    A += load[0][j];
    B += load[1][j];
  }
  let dsum = 0;
  if (A > 0 && B > 0) for (let j = 0; j < p; j++) dsum += Math.abs(load[0][j] / A - load[1][j] / B);

  // Ties.
  let strong = 0;
  let cross = 0;
  let isolated = 0;
  const bel: [number, number] = [0, 0];
  const cnt: [number, number] = [0, 0];
  let nNew = 0;
  for (const a of agents) {
    nNew += a.group;
    for (const [k, v] of a.ties) {
      if (v >= STRONG_TIE && k > a.id) {
        strong++;
        if (agents[k].group !== a.group) cross++;
      }
    }
    if (!hasStrongTie(a)) isolated++;
    const b = belongingOf(a);
    bel[a.group] += b;
    cnt[a.group] += 1;
  }
  const q = nNew / n;
  // Expected share of cross-cohort pairs if ties formed regardless of cohort.
  const expected = (2 * q * (1 - q) * n) / (n - 1);
  const bridging = strong > 0 ? cross / strong : 0;
  const visits: number[] = [];
  for (let j = 0; j < p; j++) if (plots[j].type) visits.push(load[0][j] + load[1][j]);

  return {
    day: w.day,
    rain: w.rain,
    outRate: out / n,
    dissimilarity: 0.5 * dsum,
    bridging,
    mixing: expected > 0 ? bridging / expected : 0,
    isolation: isolated / n,
    belonging: (bel[0] + bel[1]) / n,
    belongingByGroup: [cnt[0] ? bel[0] / cnt[0] : 0, cnt[1] ? bel[1] / cnt[1] : 0],
    concentration: gini(visits),
    load,
  };
}

/**
 * Belonging of one resident: each tie contributes v²/(v²+4) (a passing hello ≈ 0.2,
 * a regular ≈ 0.7), and the sum saturates: four regulars ≈ 0.43, ten ≈ 0.75.
 */
export function belongingOf(a: Agent): number {
  let sum = 0;
  for (const v of a.ties.values()) sum += (v * v) / (v * v + 4);
  return 1 - Math.exp(-sum / 5);
}

export function hasStrongTie(a: Agent): boolean {
  for (const v of a.ties.values()) if (v >= STRONG_TIE) return true;
  return false;
}

/** Open, change or close a place. Habit at a closed plot is forgotten. */
export function setPlot(w: World, id: number, type: PlaceType | null) {
  const plot = w.plots[id];
  if (!plot) return;
  plot.type = type;
  if (!type) for (const a of w.agents) a.fam[id] = 0;
  w.prevLoad[id] = 0;
  w.prevShare[0][id] = 0.5;
  w.prevShare[1][id] = 0.5;
}

/** The strongest cross-cohort ties, for drawing bridges on the map. */
export function strongestBridges(w: World, limit = 60): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const a of w.agents) {
    for (const [k, v] of a.ties) {
      if (k > a.id && v >= STRONG_TIE && w.agents[k].group !== a.group) out.push([a.id, k, v]);
    }
  }
  out.sort((x, y) => y[2] - x[2]);
  return out.slice(0, limit);
}

export function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
