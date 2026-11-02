# KATTA · case study

## The question

Cities talk about "community spaces" as if every new café, library or riverfront were the same kind of good. Sociology says otherwise: places produce **bonding** ties (within a group) and **bridging** ties (across groups) in different proportions, and people sort themselves into places by taste, price, distance and the company they expect to find. What happens when you add, price or close one place is a property of the whole system, not of the place.

KATTA turns that into something you can poke: a synthetic city whose evenings you can change and whose consequences you can measure with paired experiments.

## Who it is for

- **Students and teachers of urban/computational sociology** who want an inspectable model of Oldenburg's third places, homophily and Putnam's bonding vs. bridging distinction.
- **Civic designers and product people** who need intuition for second-order effects before arguing for an intervention.
- **Interview readers of this portfolio**: it shows modelling, statistics, rendering and product judgement in one artefact.

## Need

Existing agent-based teaching tools (NetLogo's Schelling segregation and similar) are excellent but austere, rarely about *leisure* places, and seldom pair the model with honest experimental statistics. Policy discussions, meanwhile, often treat a single run or a single anecdote as evidence.

## Value proposition

A model you can see, change and test in one page: watch it, intervene, and get a paired Monte Carlo answer with intervals, effect sizes and plain-language notes that never overclaim.

## Differentiation

1. **Paired experiments by design.** A and B share seeds (common random numbers), so differences come from the change, not from luck. An A/A test returns exactly zero.
2. **Outcomes that disagree.** Six measures with explicit "better" directions, so trade-offs (more belonging, less bridging) are visible rather than averaged away.
3. **A narrator you can audit.** Field notes are rule-based templates keyed to thresholds; no LLM writes claims.
4. **An editorial interface.** The broadsheet format makes a research tool feel worth reading; the night map makes the model's mechanics visible.

## Core workflow

Watch a fortnight → open or close a place (map or ledger) → freeze baseline → change something → run 20 × 60 → read verdicts and notes → save to notebook / export.

## Technical moat (what was hard)

- A random-utility (multinomial logit) model with feedback: yesterday's composition feeds today's homophily term; yesterday's load feeds crowding. Small changes can tip.
- Conversation dynamics that make room size matter: random partners with a mild pull to known people, so small rooms build strong ties and large rooms build many weak ones.
- Statistics implemented from scratch: t-intervals, seeded paired bootstrap, paired Cohen's d, Gini, Duncan's dissimilarity, a cohort-adjusted mixing ratio.
- A three-layer canvas renderer with additive "light" encoding, phyllotaxis seating, adaptive quality and a reduced-motion path.
- The experiment loop in a Web Worker so thousands of simulated evenings run without freezing the animation.

## Creative decisions

- People as light, cohorts as gold and rose, contact as ivory: the encoding *is* the thesis.
- Old city as courtyard blocks, new township as a tower grid: geography carries the residential-segregation story without a single word.
- Marathi used where it is native to the subject (कट्टा, टपरी, वाचनालय, घाट), not as ornament.
- Luxury Editorial palette and Swiss-grid numbering, deliberately far from drop #001's glossy Y2K desktop.

## Trade-offs and exclusions

- **No real data.** Calibrating to a real city would require survey data I do not have and would invite misreading the toy as a finding. Every screen says "synthetic".
- **Two cohorts only.** Real belonging is multi-dimensional (age, gender, class, language, faith). Two groups keep the measures interpretable.
- **No LLM.** Fluency was traded for traceability.
- **No framework.** A few panels re-rendered from state did not justify React's weight.
- **Taste parameters are assumptions** (settled residents lean to the tapri, newcomers to the café), exposed in code and in the method section rather than hidden.

## Statistical logic

- Choice: `P(j) ∝ exp(U_j / T)` over open places plus home (`U_home = 0.4`).
- Ties: +1 per conversation, ×(1 − decay) per evening, dropped below 0.1; strong at ≥ 2.5.
- Belonging: `1 − exp(−Σ v²/(v²+4) / 5)`, a saturating function that weights regular ties over passing hellos.
- Experiments: per world, the mean of the last 10 evenings; A and B paired on seed; B − A via 2,000 bootstrap resamples; verdict only when the 95% interval excludes zero.

## Example insight (from the toy)

Opening a café at Ferry Landing, 20 paired worlds × 60 evenings: belonging +1.6 pts [+1.3, +1.9], isolation −7.0 pts [−8.0, −5.9], bridging ties −2.6 pts [−3.9, −1.3], place segregation +7.8 pts [+5.8, +9.9]. One more choice made sorting easier. That is a hypothesis-generating pattern, not evidence about any city.

## Proposed metrics (if this were a product)

No usage numbers exist; these are what I would instrument:
- Experiments run per session, and share that are A/A sanity checks (are people learning to trust the bench?).
- Share of users who change ≥ 2 interventions before running (exploration depth).
- Notebook saves and exports per experiment (is the output worth keeping?).
- Time from first visit to first experiment (onboarding friction).
- For classroom use: pre/post questions on bonding vs. bridging.

## Limitations

- Not calibrated; magnitudes are meaningless outside the model.
- No daytime life, work, schooling, family or online ties.
- Distance is straight-line; the river crossing has no extra cost.
- Homophily is a single scalar for both cohorts.
- 360 residents is small; group sizes at individual places can be noisy.
- Tested in Chromium only.

## Roadmap

1. Scenario presets and a guided "three experiments" tour for teaching.
2. Per-cohort homophily and taste sliders; a third cohort.
3. Street network with bridge bottlenecks and travel time.
4. Sensitivity analysis: sweep one parameter, plot the response curve with bands.
5. Shareable scenario URLs (state in the hash, no server).
6. Optional calibration mode against user-supplied, consented survey summaries, with the synthetic label replaced by a provenance panel.
