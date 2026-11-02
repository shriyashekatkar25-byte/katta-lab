# KATTA · architecture

## Stack

TypeScript 5 + Vite 5, no UI framework (the UI is a handful of panels re-rendered from state; a framework would add weight without simplifying the canvas). Canvas 2D for the map, hand-written SVG strings for charts, one Web Worker for experiments, `localStorage` for persistence. Vitest for unit tests, Python Playwright for end-to-end checks. Static build into `docs/` for GitHub Pages (`base: '/katta-lab/'`).

## Layout

```
index.html            the broadsheet: all sections and controls
src/
  main.ts             state, wiring, animation loop, worker client
  worker.ts           runs paired Monte Carlo off the main thread
  styles.css          tokens + layout
  lib/                pure, DOM-free, unit-tested
    rng.ts            mulberry32 PRNG, Box–Muller normal, weighted draw
    model.ts          city, residents, logit choice, conversations, ties, metrics
    stats.ts          mean/sd, t-intervals, paired bootstrap, Cohen's d, Gini, Duncan D
    experiment.ts     runWorld / runExperiment / compare (common random numbers)
    report.ts         rule-based field notes and verdicts
    storage.ts        guarded localStorage, sanitising, notebook, CSV
  ui/
    map.ts            three-layer canvas renderer, hit-testing, adaptive quality
    charts.ts         sparkline, isotype census, paired dot strip
    glyphs.ts         shared SVG path data for place glyphs (SVG + Path2D)
tests/                Vitest suites (35 tests)
```

## Data flow

```
user input ──► main.ts state (city params, plot types, seed)
                 │                    │
                 ▼                    ▼
           model.step(world)     worker: runExperiment(A, B, seeds)
                 │                    │
        DayMetrics history       ExperimentResult (paired samples, CIs)
                 │                    │
   map.render / ledger / notes   results view / notes / notebook
```

The world is mutable and owned by `main.ts`; everything else reads it. One evening = one `step()`: fade ties → each resident chooses (logit) → conversations inside each room → record composition for tomorrow → compute metrics.

## Rendering

`CityMap` keeps three canvases: a static base (re-drawn on resize), a persistent trail canvas faded with `destination-out` each frame and drawn with `lighter` compositing, and the visible canvas that composites both and draws places, conversations, bridges, rain and selection. Device pixel ratio is capped at 2; an exponential moving average of render time drops to 1× DPR and hides conversation lines if frames get slow, and restores them when there is headroom.

## State and storage

`katta.v1.city` (params, plot types, seed), `katta.v1.baseline`, `katta.v1.notebook` (≤ 40 entries). Reads go through `sanitizeCity`, which repairs wrong types, non-finite numbers, unknown place types and wrong-length arrays, so an old or corrupted save cannot break the app. If storage is unavailable, everything still works for the session.

## Experiments

`runExperiment(A, B, runs, days, baseSeed)` runs world *r* of A and world *r* of B on the same seed. Because residents, homes and every random draw before the first divergence are identical, the paired difference has much lower variance than two independent samples (an A/A test returns exactly 0, which is a unit test). Each world is summarised by the mean of its last 10 evenings. Intervals: t-interval for A and B; paired bootstrap (2,000 resamples, seeded) for B − A; paired Cohen's d.

Performance: about 2 ms per simulated evening for 360 residents on a laptop-class CPU; 20 pairs × 60 evenings ≈ 5 s in the worker, during which the map keeps animating. If a Worker cannot be created, the same function runs on the main thread.

## Why there is no "AI" here

The brief allows AI where it earns its place. This app's intelligence is a transparent agent-based model with a random-utility choice rule, plus a rule-based narrator. An LLM would make the field notes more fluent and less trustworthy: every sentence now maps to a threshold and a number, which is the point of a research tool.

## Testing

- `tests/stats.test.ts`: PRNG determinism/uniformity, normal moments, weighted draws, t-values, CI behaviour, bootstrap detects a known shift and not a null, Gini, dissimilarity.
- `tests/model.test.ts`: population and cohort split, reproducibility, residential sorting, logit is a distribution, distance/rain/homophily/temperature effects, ties symmetric and decaying, metric ranges, closing a place, bridges sorted and cross-cohort.
- `tests/experiment.test.ts`: A/A gives zero, homophily raises segregation, monsoon lowers evenings out, determinism, progress callback.
- `tests/storage-report.test.ts`: storage round-trip and corruption, sanitising, notebook cap, CSV escaping, field-note content, verdict logic.
- Playwright (not committed as a test suite; run from the build pipeline): desktop 1280 and mobile 375 flows, see README.

## Deployment

`npm run build` → `tsc --noEmit && vite build` → `docs/` (index.html + hashed assets). GitHub Pages serves `main /docs`.
