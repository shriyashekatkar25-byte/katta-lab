# KATTA — case study

## The question

Cities keep removing the cheap, informal places where people who are not yet friends see each other often enough to become friends: the katta lost to a widened road, the tea stall cleared for parking, the reading room with shorter hours. Planners and product teams talk about "community" and "belonging", but rarely have a way to *reason* about which design choices plausibly matter, for whom, and how sure we can be. KATTA is an artistic and analytical question turned into a tool: **if you change the places a city offers, how does belonging change, and does it change equally for people who just arrived?**

## The user

- **Students and teachers of sociology, urban studies and statistics**, who want an inspectable model of social ties forming through co-presence rather than a black-box chart.
- **Product and civic designers** who think about "third places" (community features, co-working, libraries, public space) and need a sandbox for intuition before they reach for real data.
- **Curious readers** of interactive journalism who will not read a paper but will drag a tea stall across a map.

## The need

A way to (1) build and see a social system, (2) change one thing at a time, and (3) tell signal from noise. Most "agent-based model" demos stop at (1); most statistics teaching stops at (3) with no system worth caring about.

## Value proposition

A city you can edit in seconds, people you can click on, and an experiment harness that answers "did that change matter?" with an honest interval, all in a browser tab with no install.

## Differentiation

- **Editorial, not a dashboard.** It reads like a broadsheet field report: masthead, ledger, ethnographer's notes, method section. The interface is the argument.
- **The model is fully visible.** The method section contains every equation the code runs; the unit tests pin down the behaviour.
- **Experiments use common random numbers.** Replicate *k* of A and B share a seed, so the same synthetic people make the same coin flips wherever the scenarios agree. This is a real Monte Carlo variance-reduction technique, rarely shown in teaching tools, and it makes small effects detectable with few replicates.
- **Culturally specific without costume.** The katta is a researched Pune institution, used because it is the clearest real-world example of Oldenburg's third place, not as decoration.

## Core workflow

1. Pick a scenario (*Peth evenings*) and press Play. Watch people walk out at dusk, crowd the tea stalls, and walk home.
2. Click a person: see their ties drawn across the city, their belonging, where they are a regular.
3. Change the city: add a katta between two neighbourhoods, raise a café's price, mix the housing.
4. Set A = the original, derive B (e.g. "Close A's busiest place"), run 24 paired replicates, read the six interval plots, export CSV.

## Technical moat

- A compact, tested agent-based model: multinomial-logit place choice with distance, price × budget, conviviality, habit, friends present, homophily and crowding; tie formation through conversations with saturating updates and cross-group friction; tie and habit decay; place *reputation* as an exponential moving average, which avoids the El Farol stampede between empty and packed rooms.
- Social measures from the literature: index of dissimilarity, mixing relative to the 2p(1−p) random benchmark, local clustering coefficient, a diminishing-returns belonging index.
- Paired percentile bootstrap over CRN replicates, in a Web Worker with progress and a main-thread fallback.
- Hand-written canvas renderer (engraved base map cached offscreen, persistent desire-line layer, adaptive pixel ratio) and a stabilised force layout.

## Creative decisions

- **Desire lines.** Agents walk straight lines because that is the honest abstraction (there is no street routing), and the accumulated paths become the most beautiful part of the picture: a map of where the city actually goes in the evening.
- **Dusk as the clock.** Third places are evening institutions, so the whole simulation is one evening at a time: a rose wash, then espresso shadow, brass glows at occupied places, and a waxing chandrakor.
- **Two voices, two shapes.** Residents are oxblood circles, newcomers brass diamonds: distinguishable by shape for colour-blind readers.
- **Words written by rules.** The notes read like fieldwork, but each sentence is a template filled from the model's numbers. No language model, nothing invented.

## Engineering trade-offs and what was excluded

- **No street network routing.** It would add realism to travel distances but cost a graph library and obscure the model. Distance is Euclidean.
- **No LLM.** The notes are deterministic templates on purpose: the lab must never "say" something its numbers do not support.
- **No real demographic data.** Calibrating to a real city would invite readers to treat outputs as findings about real people. Everything is synthetic and labelled so.
- **Two groups only.** Real cities have many overlapping identities; two keeps measures interpretable (dissimilarity, 2p(1−p) mixing).
- **O(n²) layout repulsion.** Fine up to the 600-person cap; Barnes–Hut was not worth the code for this size.

## Statistical and modelling logic

- Choice: `P(j) = exp(U_j) / (exp(U_home) + Σ_k exp(U_k))`. Equivalent to adding i.i.d. Gumbel noise to each utility and taking the argmax (tested by simulation against the softmax).
- Ties: `s ← s + g(1 − s)` per conversation, `g = 0.22·conv·(1 − friction if cross-group)`; nightly decay `s ← 0.965·s`; ties under 0.03 are forgotten.
- Belonging: `B = 1 − exp(−(0.55·strong + 0.18·weak + 0.06·attachment))`.
- Experiment: outcomes averaged over each run's last 10 evenings; paired differences `d_k = B_k − A_k` resampled 2,000 times; percentile 95% interval; share of resampled means above zero reported as directional agreement.
- An example of what the lab produces (model output, not a finding about any real place): in the default *Peth evenings* city, closing its busiest place (the reading room) in a 12-replicate × 30-evening run lowered mean belonging by 0.017, interval [−0.025, −0.009], and raised the share of people with no ties by 0.017. A counter-intuitive pattern the model often shows: removing places can *raise* cross-group mixing while lowering belonging, because the remaining rooms force people to share.

## Proposed metrics (if this were deployed)

None of these have been measured; they are what I would instrument.

- Activation: share of visitors who run at least one experiment.
- Depth: median number of city edits before the first experiment.
- Comprehension: in a classroom setting, pre/post accuracy on "which change reduces the newcomer gap?" questions.
- Trust: share of experiment results downloaded as CSV (signals people want to check the numbers).

## Limitations

- Parameters are hand-set for plausibility, not estimated from data; results are qualitative.
- No time-of-day, weekday or seasonal (monsoon!) variation; one evening is the unit.
- Groups are defined by tenure only; budgets differ by a fixed synthetic offset.
- Housing does not respond to places (no gentrification feedback).
- The belonging index is a design choice, not a validated psychometric scale.

## Roadmap

1. **Monsoon mode:** rain lowers outing rates and favours covered places, a natural Maharashtrian seasonal experiment.
2. **Sensitivity sweeps:** run an experiment across a grid of homophily values and plot where the effect flips sign.
3. **Street routing** on the drawn lanes, so a bridge can be a policy lever.
4. **Shareable scenarios** encoded in the URL.
5. **Calibration notebook:** a documented, optional path to fit the choice model to survey data, kept separate from the synthetic default.

---

Original work by Shriya Shekatkar · SHRIYA.EXE · Synthetic or demo data is labeled as such. Not affiliated with any film, studio or company. Studio gallery: https://shriyashekatkar25-byte.github.io/shriya-exe/
