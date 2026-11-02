/**
 * The night map: a Canvas 2D renderer for the synthetic city.
 *
 * Three layers:
 *  1. base   — drawn once per resize: dusk ground, grain, river, the old city's
 *              courtyard (wada) blocks and the new township's tower grid.
 *  2. trails — persistent canvas faded a little every frame; residents are drawn
 *              with additive blending, gold for settled and rose for newcomers,
 *              so wherever the two cohorts share a room the light turns ivory.
 *  3. live   — places, conversations, bridges, rain, selection, composited on top.
 *
 * Each evening plays as a timeline t ∈ [0, 1): walk out (0.08–0.38), linger
 * (0.38–0.68), walk home (0.68–0.95). Lingering residents settle into a
 * phyllotaxis spiral (golden angle 137.5°) around their place.
 */
import { CITY_H, CITY_W, NEIGHBOURHOODS, PLACE_SPECS, RIVER, strongestBridges, type World } from '../lib/model';
import { mulberry32 } from '../lib/rng';
import { glyphPath } from './glyphs';

export const MAP_COLORS = {
  night: '#1A100C',
  night2: '#2A1A13',
  ivory: '#F6EFE3',
  settled: '#E6B65E',
  newcomer: '#F2A1B3',
  river: '#251E2C',
  brass: '#C99A3E',
  oxblood: '#B4384A',
};
const GROUP_RGB = ['230,182,94', '242,161,179'];
const GOLDEN = (137.508 * Math.PI) / 180;

export interface MapOptions {
  reducedMotion: boolean;
  bridges: boolean;
  trails: boolean;
}

export type Pick = { kind: 'plot'; id: number } | { kind: 'agent'; id: number } | null;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class CityMap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private trail = document.createElement('canvas');
  private tctx: CanvasRenderingContext2D;
  private k = 1; // css px per model unit
  private dpr = 1;
  private quality = 1; // 1 = full, 0 = reduced (adaptive)
  private frameEMA = 16;
  private world: World | null = null;
  private slots = new Map<number, [number, number]>();
  private bridges: [number, number, number][] = [];
  private bend = new Float32Array(0);
  private rainDrops: [number, number, number][] = [];
  selectedAgent = -1;
  selectedPlot = -1;
  hoverPlot = -1;
  options: MapOptions;

  constructor(canvas: HTMLCanvasElement, options: MapOptions) {
    this.canvas = canvas;
    this.options = options;
    const ctx = canvas.getContext('2d');
    const tctx = this.trail.getContext('2d');
    if (!ctx || !tctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.tctx = tctx;
    const r = mulberry32(99);
    for (let i = 0; i < 140; i++) this.rainDrops.push([r() * CITY_W, r() * CITY_H, 0.6 + r() * 0.8]);
  }

  /** Fit the canvas to its container width, keeping the city's aspect ratio. */
  resize() {
    const parent = this.canvas.parentElement;
    const cssW = Math.max(280, parent ? parent.clientWidth : 800);
    const cssH = Math.round((cssW * CITY_H) / CITY_W);
    this.k = cssW / CITY_W;
    const maxDpr = this.quality ? 2 : 1;
    this.dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    for (const c of [this.canvas, this.base, this.trail]) {
      c.width = Math.round(cssW * this.dpr);
      c.height = Math.round(cssH * this.dpr);
    }
    this.canvas.style.height = `${cssH}px`;
    this.drawBase();
  }

  setWorld(w: World) {
    this.world = w;
    const r = mulberry32(w.agents.length * 31 + 7);
    this.bend = new Float32Array(w.agents.length).map(() => (r() - 0.5) * 0.5);
    this.newEvening();
    this.tctx.clearRect(0, 0, this.trail.width, this.trail.height);
  }

  /** Called after each simulated evening: recompute where everyone sits. */
  newEvening() {
    const w = this.world;
    if (!w) return;
    this.slots.clear();
    const counts = new Array(w.plots.length).fill(0);
    for (const a of w.agents) {
      const j = w.attend[a.id];
      if (j < 0) continue;
      const k = counts[j]++;
      const plot = w.plots[j];
      const r = 13 + 3.1 * Math.sqrt(k + 1);
      const th = k * GOLDEN;
      this.slots.set(a.id, [plot.x + r * Math.cos(th), plot.y + r * Math.sin(th)]);
    }
    this.bridges = this.options.bridges ? strongestBridges(w, 70) : [];
  }

  refreshBridges() {
    this.bridges = this.options.bridges && this.world ? strongestBridges(this.world, 70) : [];
  }

  private drawBase() {
    const c = this.base.getContext('2d');
    if (!c) return;
    const s = this.k * this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const g = c.createRadialGradient(this.base.width * 0.45, this.base.height * 0.45, 10, this.base.width * 0.5, this.base.height * 0.5, this.base.width * 0.75);
    g.addColorStop(0, MAP_COLORS.night2);
    g.addColorStop(1, MAP_COLORS.night);
    c.fillStyle = g;
    c.fillRect(0, 0, this.base.width, this.base.height);
    c.setTransform(s, 0, 0, s, 0, 0);

    // Grain.
    const r = mulberry32(2004);
    c.fillStyle = 'rgba(246,239,227,0.035)';
    for (let i = 0; i < 2600; i++) c.fillRect(r() * CITY_W, r() * CITY_H, 0.9, 0.9);

    // River, as a smoothed polyline in three passes (bank glow, water, ripple lines).
    const riverPath = () => {
      c.beginPath();
      c.moveTo(RIVER[0][0], RIVER[0][1]);
      for (let i = 1; i < RIVER.length - 1; i++) {
        const mx = (RIVER[i][0] + RIVER[i + 1][0]) / 2;
        const my = (RIVER[i][1] + RIVER[i + 1][1]) / 2;
        c.quadraticCurveTo(RIVER[i][0], RIVER[i][1], mx, my);
      }
      const last = RIVER[RIVER.length - 1];
      c.lineTo(last[0], last[1]);
    };
    c.lineCap = 'round';
    c.lineJoin = 'round';
    riverPath();
    c.strokeStyle = 'rgba(201,154,62,0.10)';
    c.lineWidth = 58;
    c.stroke();
    riverPath();
    c.strokeStyle = MAP_COLORS.river;
    c.lineWidth = 46;
    c.stroke();
    for (const [off, a] of [[-12, 0.10], [0, 0.07], [12, 0.10]] as const) {
      c.save();
      c.translate(off, 0);
      riverPath();
      c.setLineDash([18, 26]);
      c.strokeStyle = `rgba(246,239,227,${a})`;
      c.lineWidth = 1;
      c.stroke();
      c.restore();
    }
    c.setLineDash([]);

    // Two bridges.
    c.strokeStyle = 'rgba(246,239,227,0.22)';
    c.lineWidth = 3;
    for (const y of [205, 430]) {
      c.beginPath();
      c.moveTo(405, y);
      c.lineTo(555, y + 6);
      c.stroke();
    }

    // Built fabric. Old city: courtyard blocks of irregular size, slightly rotated.
    // New township: a strict grid of tower footprints with lit windows.
    for (const h of NEIGHBOURHOODS) {
      const rr = mulberry32(h.name.length * 977 + h.x);
      if (h.side === 0) {
        const rot = (rr() - 0.5) * 0.35;
        for (let i = 0; i < 26; i++) {
          const ang = rr() * Math.PI * 2;
          const rad = 18 + rr() * 105;
          const x = h.x + Math.cos(ang) * rad;
          const y = h.y + Math.sin(ang) * rad * 0.8;
          if (x > 400 || x < 10 || y < 10 || y > CITY_H - 10) continue;
          const bw = 18 + rr() * 22;
          const bh = 16 + rr() * 18;
          c.save();
          c.translate(x, y);
          c.rotate(rot + (rr() - 0.5) * 0.12);
          c.fillStyle = 'rgba(64,40,28,0.55)';
          c.strokeStyle = 'rgba(246,239,227,0.13)';
          c.lineWidth = 0.8;
          c.fillRect(-bw / 2, -bh / 2, bw, bh);
          c.strokeRect(-bw / 2, -bh / 2, bw, bh);
          // Courtyard (chowk) and its tulsi point.
          c.fillStyle = MAP_COLORS.night;
          c.fillRect(-bw * 0.2, -bh * 0.2, bw * 0.4, bh * 0.4);
          c.fillStyle = 'rgba(201,154,62,0.45)';
          c.beginPath();
          c.arc(0, 0, 0.9, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
      } else {
        for (let gx = -4; gx <= 4; gx++) {
          for (let gy = -3; gy <= 3; gy++) {
            if (rr() < 0.42) continue;
            const x = h.x + gx * 26;
            const y = h.y + gy * 26;
            if (x < 560 || x > CITY_W - 10 || y < 10 || y > CITY_H - 10) continue;
            c.fillStyle = 'rgba(52,40,48,0.7)';
            c.strokeStyle = 'rgba(246,239,227,0.12)';
            c.lineWidth = 0.8;
            c.fillRect(x - 8, y - 8, 16, 16);
            c.strokeRect(x - 8, y - 8, 16, 16);
            c.fillStyle = 'rgba(246,239,227,0.22)';
            for (let wx = 0; wx < 3; wx++) for (let wy = 0; wy < 3; wy++) if (rr() < 0.5) c.fillRect(x - 5 + wx * 4, y - 5 + wy * 4, 1.4, 1.4);
          }
        }
      }
    }

    // Labels.
    c.font = '600 10px "Space Grotesk", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(246,239,227,0.5)';
    for (const h of NEIGHBOURHOODS) {
      const label = h.name.toUpperCase().split('').join(' ');
      c.fillText(label, h.x, h.y - 64);
    }
    c.textAlign = 'left';
    c.font = 'italic 11px "Fraunces", serif';
    c.fillStyle = 'rgba(246,239,227,0.45)';
    c.fillText('a synthetic city · not to scale', 18, CITY_H - 16);
    c.save();
    c.translate(474, 610);
    c.rotate(-1.45);
    c.font = 'italic 12px "Fraunces", serif';
    c.fillStyle = 'rgba(246,239,227,0.35)';
    c.fillText('the river', 0, 0);
    c.restore();
    // North arrow.
    c.strokeStyle = 'rgba(246,239,227,0.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(CITY_W - 30, 50);
    c.lineTo(CITY_W - 30, 22);
    c.lineTo(CITY_W - 34, 30);
    c.moveTo(CITY_W - 30, 22);
    c.lineTo(CITY_W - 26, 30);
    c.stroke();
    c.font = '600 9px "Space Grotesk", sans-serif';
    c.fillStyle = 'rgba(246,239,227,0.5)';
    c.fillText('N', CITY_W - 33.5, 63);
  }

  /** Where agent `id` is at evening-time t. */
  private position(id: number, t: number): [number, number, boolean] {
    const w = this.world!;
    const a = w.agents[id];
    const slot = this.slots.get(id);
    if (!slot) return [a.x, a.y, false];
    let e: number;
    if (t < 0.08) e = 0;
    else if (t < 0.38) e = ease((t - 0.08) / 0.3);
    else if (t < 0.68) e = 1;
    else if (t < 0.95) e = 1 - ease((t - 0.68) / 0.27);
    else e = 0;
    // A gentle sideways bow so the walk reads as streets, not straight lines.
    const dx = slot[0] - a.x;
    const dy = slot[1] - a.y;
    const bow = Math.sin(Math.PI * e) * this.bend[id];
    return [a.x + dx * e - dy * bow, a.y + dy * e + dx * bow, true];
  }

  render(t: number, now: number) {
    const w = this.world;
    if (!w) return;
    const start = performance.now();
    const reduced = this.options.reducedMotion;
    const tt = reduced ? 0.5 : t;
    const s = this.k * this.dpr;
    const ctx = this.ctx;
    const tc = this.tctx;

    // --- trails ---
    tc.setTransform(1, 0, 0, 1, 0, 0);
    if (reduced || !this.options.trails) {
      tc.clearRect(0, 0, this.trail.width, this.trail.height);
    } else {
      tc.globalCompositeOperation = 'destination-out';
      tc.fillStyle = `rgba(0,0,0,${this.quality ? 0.12 : 0.22})`;
      tc.fillRect(0, 0, this.trail.width, this.trail.height);
    }
    tc.globalCompositeOperation = 'lighter';
    tc.setTransform(s, 0, 0, s, 0, 0);
    for (const a of w.agents) {
      const [x, y, out] = this.position(a.id, tt);
      tc.fillStyle = `rgba(${GROUP_RGB[a.group]},${out ? 0.85 : 0.22})`;
      const rad = out ? 1.7 : 1.1;
      tc.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    tc.globalCompositeOperation = 'source-over';

    // --- compose ---
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.trail, 0, 0);
    ctx.setTransform(s, 0, 0, s, 0, 0);

    // Bridges: the strongest cross-cohort friendships, drawn home to home.
    if (this.options.bridges && this.bridges.length) {
      ctx.lineWidth = 0.7;
      for (const [i, j, v] of this.bridges) {
        const a = w.agents[i];
        const b = w.agents[j];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - Math.abs(a.x - b.x) * 0.25;
        ctx.strokeStyle = `rgba(246,239,227,${Math.min(0.5, 0.08 + v * 0.03)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
      }
    }

    // Conversations while people linger.
    if (tt > 0.4 && tt < 0.66 && (this.quality || reduced)) {
      const flick = reduced ? 1 : Math.sin(((tt - 0.4) / 0.26) * Math.PI);
      ctx.lineWidth = 0.6;
      for (const [i, j] of w.conversations) {
        const p = this.slots.get(i);
        const q = this.slots.get(j);
        if (!p || !q) continue;
        const cross = w.agents[i].group !== w.agents[j].group;
        ctx.strokeStyle = cross ? `rgba(246,239,227,${0.75 * flick})` : `rgba(${GROUP_RGB[w.agents[i].group]},${0.28 * flick})`;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
    }

    // Places.
    for (const plot of w.plots) {
      const active = plot.id === this.selectedPlot || plot.id === this.hoverPlot;
      if (!plot.type) {
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = active ? 'rgba(246,239,227,0.9)' : 'rgba(246,239,227,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(plot.x, plot.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(plot.x - 3, plot.y);
        ctx.lineTo(plot.x + 3, plot.y);
        ctx.moveTo(plot.x, plot.y - 3);
        ctx.lineTo(plot.x, plot.y + 3);
        ctx.stroke();
      } else {
        const spec = PLACE_SPECS[plot.type];
        const load = w.attend.length ? countAt(w, plot.id) : 0;
        const over = load > spec.capacity;
        ctx.fillStyle = 'rgba(26,16,12,0.86)';
        ctx.beginPath();
        ctx.arc(plot.x, plot.y, 12.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = over ? MAP_COLORS.oxblood : active ? MAP_COLORS.ivory : MAP_COLORS.brass;
        ctx.lineWidth = active ? 1.6 : 1;
        ctx.stroke();
        ctx.save();
        ctx.translate(plot.x - 8, plot.y - 8);
        ctx.scale(16 / 24, 16 / 24);
        ctx.strokeStyle = MAP_COLORS.ivory;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(glyphPath(plot.type));
        ctx.restore();
        // Rain makes outdoor places glisten oxblood.
        if (w.rain && spec.outdoor) {
          ctx.strokeStyle = 'rgba(180,56,74,0.6)';
          ctx.beginPath();
          ctx.arc(plot.x, plot.y, 15.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (active) {
        ctx.font = '600 11px "Space Grotesk", sans-serif';
        const label = plot.type ? `${plot.name} · ${PLACE_SPECS[plot.type].name}` : `${plot.name} · empty plot`;
        const tw = ctx.measureText(label).width;
        const lx = Math.min(CITY_W - tw - 12, Math.max(6, plot.x - tw / 2 - 6));
        const ly = plot.y + 20;
        ctx.fillStyle = 'rgba(246,239,227,0.94)';
        ctx.fillRect(lx, ly, tw + 12, 18);
        ctx.fillStyle = MAP_COLORS.night;
        ctx.fillText(label, lx + 6, ly + 13);
      }
    }

    // Selected resident and their ties.
    if (this.selectedAgent >= 0 && this.selectedAgent < w.agents.length) {
      const a = w.agents[this.selectedAgent];
      const [x, y] = this.position(a.id, tt);
      const ties = [...a.ties.entries()].sort((p, q) => q[1] - p[1]).slice(0, 10);
      for (const [k, v] of ties) {
        const [bx, by] = this.position(k, tt);
        ctx.strokeStyle = `rgba(246,239,227,${Math.min(0.9, 0.15 + v * 0.1)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.strokeStyle = MAP_COLORS.ivory;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 7 + (reduced ? 0 : Math.sin(now / 300) * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rain.
    if (w.rain) {
      ctx.strokeStyle = 'rgba(200,210,235,0.22)';
      ctx.lineWidth = 0.8;
      const off = reduced ? 0 : (now / 6) % CITY_H;
      ctx.beginPath();
      for (const [x, y, sp] of this.rainDrops) {
        const yy = (y + off * sp) % CITY_H;
        const xx = (x - off * sp * 0.25 + CITY_W) % CITY_W;
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx - 3, yy + 12);
      }
      ctx.stroke();
    }

    // Adaptive quality: if frames get slow, drop resolution and conversation lines.
    const dt = performance.now() - start;
    this.frameEMA = this.frameEMA * 0.95 + dt * 0.05;
    if (this.quality === 1 && this.frameEMA > 14) {
      this.quality = 0;
      this.resize();
    } else if (this.quality === 0 && this.frameEMA < 4) {
      this.quality = 1;
      this.resize();
    }
  }

  get qualityLabel() {
    return this.quality ? 'full' : 'reduced';
  }

  /** Hit-test a pointer position against places first, then residents. */
  pick(clientX: number, clientY: number, t: number): Pick {
    const w = this.world;
    if (!w) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * CITY_W;
    const my = ((clientY - rect.top) / rect.height) * CITY_H;
    let best = -1;
    let bd = 20 * 20;
    for (const p of w.plots) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    if (best >= 0) return { kind: 'plot', id: best };
    let ba = -1;
    let bad = 9 * 9;
    const tt = this.options.reducedMotion ? 0.5 : t;
    for (const a of w.agents) {
      const [x, y] = this.position(a.id, tt);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bad) {
        bad = d;
        ba = a.id;
      }
    }
    return ba >= 0 ? { kind: 'agent', id: ba } : null;
  }
}

function countAt(w: World, plot: number): number {
  let n = 0;
  for (let i = 0; i < w.attend.length; i++) if (w.attend[i] === plot) n++;
  return n;
}
