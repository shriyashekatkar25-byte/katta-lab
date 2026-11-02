# KATTA · art direction

## Creative thesis

A research instrument dressed as a broadsheet. The question (where does a city spend its evenings, and who comes to belong?) is sociological, so the page reads like a serious weekend supplement: a masthead, numbered sections, hairline rules, a glossary, field notes. At its centre sits one night-time map where people are light, and where two cohorts sharing a room literally add up to a brighter colour.

## Moodboard (described, not copied)

- **Isotype and pictogram statistics** (Neurath-style counting figures seen on a Pinterest search for editorial data-visualisation posters): one mark per person, counted rather than summarised. Became the census of belonging.
- **Pune old-city wada architecture** (Pinterest search for Pune wada architecture): arched timber windows, inner courtyards (chowk), bold Devanagari signage. Became the courtyard blocks of the old city on the map, the arched-window glyph for the vachanalay, and the Devanagari secondary title.
- **Swiss editorial grid** (Pinterest search for Swiss editorial layouts in red and ivory): big numerals, strict columns, one hot accent on a pale ground. Became the outlined section numerals, the masthead dateline and the oxblood-on-ivory system.
- **Creative-coding particle trails** (Codrops search for particle trails; Awwwards data-visualisation category): additive light, persistence of motion. Became the trail layer.

Nothing from these was downloaded, traced or embedded; see CREDITS.md.

## Colour tokens (Luxury Editorial family)

| Token | Hex | Use | Contrast on ivory #F4ECDF |
|---|---|---|---|
| `--ivory` | #F4ECDF | page ground | — |
| `--paper` | #FBF6EE | buttons, code | — |
| `--espresso` | #22150F | body text, rules | 15.2:1 |
| `--ink-2` | #5A473C | secondary text | 7.5:1 |
| `--oxblood` | #7A1F2B | accent text, primary button | 8.7:1 |
| `--brass-ink` | #6E5214 | settled-cohort labels | 6.2:1 |
| `--rose-ink` | #8F3A4D | newcomer labels | 6.2:1 |
| `--rose` | #E9C3BF | fills, selection | decorative only |
| `--brass` | #C99A3E | map rings, split bars | decorative only |
| map `night` | #1A100C | map ground | ivory text on it 16.4:1 |
| map `settled` | #E6B65E | settled residents (light) | — |
| map `newcomer` | #F2A1B3 | newcomer residents (light) | — |

Gold + rose under additive blending tends toward ivory: the map's one visual idea.

## Typography

- **Fraunces** (variable, opsz 9–144, SOFT/WONK axes): display italic at 900 for the masthead, light 300 optical-size-144 for big numerals, 600 for section heads, text sizes for the dek, notes and method.
- **Space Grotesk**: interface, small caps labels (0.14–0.18em tracking).
- **IBM Plex Mono**: every number that came out of the model, so computed values look different from prose.
- **Tiro Devanagari Marathi**: कट्टा, place names in Marathi (टपरी, वाचनालय, घाट, चित्रपटगृह, कॅफे), cohort names (जुने, नवीन).

## Composition

12-column editorial grid, max 1280px. Masthead → 01 City (map 2/3 + console 1/3, then plot ledger and tuning) → 02 Ledger (3×2 metric grid, census) → 03 Experiment (roman-numbered steps, results) → 04 Field notes (two columns with column rule, notebook) → 05 Method. Below 1000px everything stacks; below 720px the console, plots and sliders go single-column, metrics go 2-up.

## Interaction philosophy

Direct where possible, accessible always: every map action has a list equivalent (plots have a `<select>`; the inspector is an `aria-live` region; the canvas has a text twin in the Tonight panel). Space plays/pauses, N steps one evening, Esc clears selection.

## Motion

- One easing (`cubic-bezier(.22,.8,.24,1)`), two durations (160ms UI, 420ms reveals).
- Evening timeline: walk out (ease-in-out cubic), linger in a golden-angle spiral, walk home with a slight bow so paths read as streets.
- Results rows rise in sequence (60ms stagger).
- `prefers-reduced-motion`: no autoplay, no trails, residents shown seated, rain static, CSS animations near-zero.

## Graphic assets

All original: five line glyphs (tapri awning, arched reading-room window, ghat steps, cinema marquee, cup and saucer) defined once as SVG path data and reused as `Path2D` on canvas; procedural courtyard blocks and tower grids; isotype figures; favicon.
