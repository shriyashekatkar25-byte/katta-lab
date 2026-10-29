# KATTA · कट्टा — a laboratory of third places

**Where do strangers become regulars?** Build a city of chai tapris, roadside kattas, reading rooms and maidans, release a few hundred synthetic residents into its evenings, watch belonging form (or fail to), and then test your intuition with paired Monte Carlo experiments, all in the browser.

SHRIYA.EXE · drop #002 · **Live demo → https://shriyashekatkar25-byte.github.io/katta-lab/**

*Katta* (कट्टा) is the Marathi word for the roadside ledge where Pune's regulars once sat and argued for hours: a textbook example of what the sociologist Ray Oldenburg called a *third place*. Most were lost to road widening and traffic. This lab asks what is lost, and for whom, when places like that go.

![The city at dusk](docs/screenshots/01-city-desktop.png)

| Ledger and place inspector | Paired experiment | Web of ties |
|---|---|---|
| ![](docs/screenshots/02-ledger-inspector.png) | ![](docs/screenshots/03-experiment.png) | ![](docs/screenshots/04-web-of-ties.png) |

## What it does

- **A living map.** An engraved city (river hatching, hill contours, lanes, one tiny block per household) where every synthetic person walks from home to tonight's place and back. Repeated walks accumulate as *desire lines*. Places glow as dusk falls; a ring shows tonight's crowd against capacity; a waxing *chandrakor* crescent keeps the evening's time.
- **Build the city.** Add a katta, chai tapri, reading room (वाचनालय), café, maidan or vyayamshala anywhere by clicking; drag to move; tune price, capacity, conviviality and opening evenings per place; remove places. Keyboard: focus the map, `[` / `]` cycle places, arrows move (Shift = faster), Delete removes, Esc deselects, Space plays/pauses.
- **The levers.** Population, newcomer share, housing mix, sociability (these restart the city); homophily, cost of distance, price sensitivity, cross-group friction (live). Four scenarios: *Peth evenings*, *Traffic took the kattas*, *Satellite township*, *Blank city*. Seeds are explicit and reproducible.
- **The field notebook.** Live belonging (residents vs newcomers), belonging gap, share with no ties, cross-group mixing relative to chance, dissimilarity index, outing rate, each with a sparkline; an inspector for any person or place; and *ethnographer's notes* written by deterministic rules from the model's own numbers.
- **Tonight's ledger.** A sortable-by-crowd table of every place: crowd vs capacity, newcomer share, regulars. Rows select places (an accessible alternative to the canvas).
- **Web of ties.** The same people as a force-directed network that starts from where they live and settles into social structure. Node size = belonging; rose lines cross groups.
- **The experiment.** Set A and B from the current city (or derive B: close A's busiest place, halve every price, add a central katta, mix the housing), choose replicates and evenings, and run. Each replicate pair shares a seed (common random numbers); results show every replicate as a strip plot plus the paired-bootstrap 95% interval of B − A for six outcomes. Runs in a Web Worker; CSV export.
- **Your cities.** Save up to eight named cities; the current city autosaves. Everything stays in this browser (localStorage). No accounts, analytics or network calls apart from Google Fonts.

## Run it

```bash
npm install
npm run dev      # local dev server
npm test         # Vitest unit tests
npm run build    # type-check + production build into docs/
```

## Architecture (summary)

TypeScript + Vite, no UI framework. All modelling and statistics live in DOM-free modules under `src/lib/` and are unit tested; `src/ui/` only renders.

```
src/
  main.ts          controller: scenario state, animation clock, wiring
  worker.ts        runs experiments off the main thread
  lib/  city (geography, place types, presets) · model (agent-based Sim) ·
        metrics (belonging, dissimilarity, clustering, gini, mixing) ·
        stats (paired bootstrap) · experiment (CRN replicates, CSV) ·
        notes (rule-based field notes) · force (network layout) ·
        storage (guarded localStorage) · rng · tokens
  ui/   mapView (engraved canvas map, desire lines, people) · webView (network) ·
        charts (SVG sparklines, strip + interval plots) · dom
  styles/main.css
tests/  model · metrics · experiment (+ rng, stats) · storage (+ force, contrast)
```

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · art direction: [docs/DESIGN.md](docs/DESIGN.md) · product thinking: [CASE_STUDY.md](CASE_STUDY.md).

## Tech stack

TypeScript 5 · Vite 5 · Canvas 2D · SVG · Web Workers · localStorage · Vitest + jsdom · Python Playwright (end-to-end checks). Fonts: Fraunces, DM Sans, DM Mono, Tiro Devanagari Marathi (Google Fonts).

## Testing status

Recorded on the build that is published:

- `npx tsc --noEmit`: no errors.
- `npm test`: **37 tests passed in 4 files** (model 14, experiment + rng + stats 9, metrics 8, storage + force + contrast 6). Includes: determinism per seed, symmetric bounded ties, softmax sampling matches logit probabilities, A-vs-identical-A gives exactly zero difference under common random numbers, bootstrap recovers a known shift, corrupted storage is ignored, colour tokens pass WCAG AA.
- `npm run build`: succeeded (main JS ≈ 53 kB / 20 kB gzipped; worker 7.6 kB).
- Playwright (Chromium) against the built `docs/` at 1280×900 and 375×812: **15 scripted checks passed** (evenings advance, add a katta by click, inspector edit, keyboard delete, +10 evenings with notes, derive B, run a 12×30 experiment to six result rows, saved city persists across reload, blank-city empty state, no horizontal scroll at 375 px, reduced motion does not autoplay), 0 console errors. Google Fonts were served from local copies during these checks because the test sandbox cannot reach Google.

Not tested: real phones, Safari/Firefox, screen readers end to end.

## Credits

Visual research references and what was taken from each: [CREDITS.md](CREDITS.md). The map, glyphs, charts and layout are original code. All people in the simulation are synthetic.

---

Original work by Shriya Shekatkar · SHRIYA.EXE · Synthetic or demo data is labeled as such. Not affiliated with any film, studio or company. Studio gallery: https://shriyashekatkar25-byte.github.io/shriya-exe/
