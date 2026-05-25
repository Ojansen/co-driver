# Wishlist

Ideas worth building. **Not a roadmap** — none of these are commitments.
Filtered through the locked tool philosophy (2026-05-21): co-driver is a
personal tuning instrument; **measurement-not-prescription**; player-centric
language; build and tune as separate layers; the loop is tune-and-measure
with `/tune/*` and `/upgrade/*` as the only prescriptive surfaces.

Last refreshed 2026-05-25 (post-manual).

---

## Recently shipped

- **Auto baseline tune (calibration pending)** — `app/utils/auto-tune.ts`
  + `app/components/AutoTuneGenerator.vue`, mounted on the build detail
  page above the manual "New tune" card. Three dials — stiffness
  (soft/medium/stiff) × balance (loose/neutral/tight) × surface
  (road/dirt/cross) — feed a pure calculator that reads the existing
  build (weight, weight-front %, drivetrain, aero) and writes a complete
  tune row through the existing `/api/builds/[id]/tunes` POST. Spring
  rates use the frequency method (`k = (2π·f)² · m / 1000`, lb/in);
  dampers / ARB / ride height / camber / toe / caster / tire pressure /
  diff (drivetrain-gated) / brake balance all populate from physics +
  surface lookups. **Philosophy fit:** baseline-as-on-ramp, not
  prescription — the `/tune` diagnostic workflow (damper histograms,
  load, G-G) stays the main event. The generator only provides a
  starting point that newcomers can refine, instead of asking them to
  learn every slider before they touch the car. No symptom→fix rules,
  no driving-data feedback in v1; this is the *physics seed*, the
  diagnostic layer does the rest. 18 unit tests, lint clean.

  **Calibration status:** the constants in `auto-tune.ts` CALIBRATION
  section are starting estimates from suspension physics + community
  norms; expect outputs to be in the right neighborhood but not
  tournament-ready. The damper raw → 1-20 mapping and the ARB 1-65
  scaling are the biggest unknowns — there is no public FH6 source for
  these yet (game is one week old).

  **What to do to verify later** (≈ 30 min in ForzaTune + 30 min refit):
  1. Pick **6 representative builds** spanning the matrix: light FWD
     road, mid-weight RWD road, heavy AWD road, light dirt buggy,
     RWD cross-country, S2 GT-style. Note each one's weight,
     weight-front %, drivetrain, tire compound.
  2. For each build, open ForzaTune's FH6-beta calculator and capture
     its full tune output at **3 stiffness presets** (soft / medium /
     stiff) with the closest equivalent of "neutral balance, surface
     matching the build." That's 18 captures total.
  3. Add **3 more captures** for one build (any one) across the
     **balance** axis (loose / neutral / tight) at medium stiffness,
     to verify the linear-scaling assumption for balance.
  4. Record into a CSV with columns: build_id, dials, springsF/R,
     bumpF/R, reboundF/R, arbF/R, rideHeightF/R, camberF/R, casterF,
     toeF/R, tirePressureF/R, diff fields, brakeBalance, aeroBalance.
  5. Back-solve the constants by comparing ForzaTune output to
     `computeAutoTune` output at the same dials. Specifically refit:
     - `FREQ_FRONT_BASE` per surface (springs give it away directly;
       you know mass + dist, so `f = √(k·1000 / m) / (2π)`)
     - The damper 1-20 mapping — fit a line/curve so our 6 medium-
       stiffness captures match ForzaTune within ±2 clicks
     - `ARB_FRONT_BASE` / `ARB_REAR_BASE` — average the 18 captures
     - Diff direction (we guessed "tight ⇒ more lock"; check it)
  6. Sanity-check against 2-3 published FH6 community baseline tunes
     if any exist by then (forzatune.com, r/ForzaHorizon).
  7. Edit the CALIBRATION constants in `app/utils/auto-tune.ts` and
     re-run `bun test:unit -- auto-tune` — the sanity-range tests
     should still pass; if they don't, the new constants are
     out-of-band.

  **Where to find the calibration knobs:** they're all named
  constants in `app/utils/auto-tune.ts` under the `CALIBRATION`
  banner (lines ~50-100). No formula changes needed — just numeric
  refits.

- **Per-surface manual at `/manual/*`** — commit `a51dfaf`. Reading
  guide for every visualization the tool ships, organized by where
  it lives: one page per surface (`/manual/live`, `/manual/replay`,
  `/manual/compare`, `/manual/hotlap`), each with context-appropriate
  "what / how / shape interpretations" entries for the graphs on
  that surface. New reusable `ManualEntry.vue` (title + where +
  intro / how / shapes / seeAlso slots) keeps each page consistent
  without duplicating markup. Context-local "manual" links land on
  every surface: floating top-right on `/live`, in the bottom
  metadata strip on `/hotlap`, in the PageHeader breadcrumb on
  `/compare`, and inside the player header on `ReplayPlayer`. The
  global-nav entry routes to the `/manual` index. Driven by an
  observation about the visualization sprawl, not a pre-existing
  wishlist item.
- **Suspension tuning surface upgrade** — commits `d5f2550` +
  `a6b167f` + `4b53332`. Three-part build addressing the most
  community-used (and hardest to read) part of tuning:
  (1) **Real-time damper velocity per corner** on `CornerPanel` —
  signed mm/s readout derived in `CornerView` from frame-to-frame
  `suspensionMeters` deltas with pause-edge guards; color reflects
  the pro-tool zone convention (slow / medium / fast).
  (2) **Damper velocity histogram per corner over a whole lap** —
  the pro-tool standard view. New pure module
  `app/utils/damper-velocity.ts` (16 unit tests), new
  `SuspensionHistogram.vue` (2×2 grid, 12% target line, zone-time-
  share row). Reads as a symmetric cone near 0 mm/s — wide = damper
  too soft, narrow = too stiff, asymmetry = unbalanced bump/rebound.
  Mounted on the replay player (whole-lap aggregate) and on the
  `/tune/dampers` slug page (last 5 laps, server-precomputed so raw
  frames stay on the server via `/api/tune-data`).
  (3) **A vs B histograms on `/compare`** — chassis-behavior diff
  between two tunes at a glance, mounted between TrackMap and the
  sector/apex tables.
  Validated end-to-end against session 19's real data: 7080 samples
  per corner, mean ≈ 0, expected bump-vs-rebound asymmetry, peaks
  at ~16-19 % in the near-zero bin. Driven by community research,
  not a pre-existing wishlist item — but consumes the natural
  next-step for both the `/tune/dampers` data panel and the
  `/replay` per-lap-summary surface.
- **G-G scatter envelope on `/live`** — commit `c7e8d75`. The chassis
  G-G dot in `CenterPanel` now renders ~20 s of history as a fading
  amber scatter (200 samples, decimated to ~10 Hz) instead of a
  glowing 1 s connected line. Density across the disc carries the
  shape: a top-to-side arc reads as trail-braking, a vertical bar as
  straight-line braking + acceleration, a horizontal blob as sustained
  cornering — no copy required. Partial completion of the "G-G trail /
  scatter" wishlist item; whole-lap version on `/replay` and `/compare`
  remains open.
- **`/compare` upgrades** — commit `dafd0b4`. Five bundled changes:
  (1) **Δ TIME promoted to headline** in `OverlayTraces` — now the top
  row at 2× height instead of the 4th row of four equal-weight rows.
  (2) **Per-side lap dropdowns + ⇄ swap button** so any A/B pair is
  reachable in one click, fed by a new `/api/events/[id]/laps`
  endpoint. (3) **TrackMap overlay** of both routes in their legend
  colors (A=white, B=amber) via a new optional `stroke` field on
  `TrackTrace`; color-mode chips auto-hide when every trace has an
  explicit stroke. (4) **Sector times + min-speed-per-sector
  tables** side by side, consistently colored green when A did
  better. (5) **Setup diff** panel reusing `diffSetup` from
  Before/After Compare — frames endpoint extended to include build +
  tune snapshots.
- **`/hotlap` driver-glance page** — commit `355c542`. Live reference-lap
  delta (zero-centred bar + giant current-lap clock), F1-style per-sector
  cells (purple / green / yellow / red), predicted lap, theoretical lap
  (sum of sector PBs), and a compact reference-route map with a live
  cursor. Reference is the session-best so far with an all-time
  car+event PB fallback via a new `/api/cars/:ordinal/best-lap`
  endpoint, so the page is useful from the first lap. Knocks out
  best-theoretical-lap outright and makes the reference-lap math
  (`utils/lap-reference.ts`) reusable for ghost-lap-on-/live later.
- **Per-sector times in the lap table** — commit `b262c90`. Each lap
  reports three sector times (equal-distance splits over
  `lap.distance`); the session-best sector per column gets the
  standard pro-tool green highlight. Gated by `SECTOR_LIKE_TYPES` so
  drag/freeroam stay off. Unlocks best-theoretical-lap and apex-speed
  as cheap follow-ons (both still on the wishlist, deliberately
  unbundled).
- **`/upgrade/*` "Your data" panels (5 slugs)** — commit `674afb9`.
  Bindings for the upgrade categories where telemetry genuinely
  informs the decision: `tires`, `drivetrain-conversion`,
  `engine-swap`, `aspiration`, `aero-body`. Five other upgrade slugs
  (`brakes`, `suspension-class`, `drivetrain-parts`, `weight`, `rims`)
  intentionally stay as static reference — either the build artifact
  already answers them or the relevant signals belong on a `/tune`
  page. Reuses `useTuneData` + `summarizeFrames`; added `summarizePower`
  and `summarizeBoost` to the signal layer.
- **`/tune/*` "Your data" panels** — commits `9fcaab5` (backend) +
  `941fef6` (frontend). Each `/tune/[slug]` page now shows a measurement
  panel above the static copy, populated from the last 5 laps on the
  most-recently-driven car + build (or `?car=&build=` override). 11
  bespoke per-slug bindings; drivetrain-aware for differential /
  center-diff.
- **Before/After Compare** — commit `e6a2f05`. Auto-pairs current session
  with the most recent prior on the same `(carId, eventId)`. Renders
  measurement deltas (best lap, trail-brake ratio, peak power) and a
  setup diff (build + tune) via `diffSetup` over the existing field
  registries. The headline expression of the glass-box-measurement
  angle; gated phase #6 (telemetry-grounded reference pages).
- **Click-to-seek on the replay map** — commit `a5cb9b3`. Alt-click on the
  replay TrackMap jumps to the nearest frame by world (x, z) position.
  Adopted from the MoTeC/AiM pro-tool pattern.
- **Differential cursor on TraceStrip** — commit `a5cb9b3`. Alt-click drops
  a cyan anchor; header shows Δt and right-edge pills switch to Δ-mode per
  channel. Active on `/live` and `/replay`. MoTeC i2's hallmark
  interaction, adapted to our component.
- **`/upgrade` reference** — commit `af0bbce`. Companion to `/tune` covering
  the build-side: 11 categories, per-discipline efficiency matrix, traps,
  11-step homologation flow, 10 build smells. Completes the build-vs-tune
  separation principle on the prescriptive side.
- **Trace window 10s → 30s** — commit `08f323a`. `TRACE_BUFFER_SIZE` 600 →
  1800. Affects `/live` and `/replay` trace strips.
- **Tune artifact + per-build list + session attach** — commit `d21b15f`
  (phase 1b). Slider numbers now persist as structured artifacts on top of
  builds.
- **setups → builds refactor** — commit `6125e35`. Car-owned builds; builds
  host tunes.
- **Structured Build artifact** — commit `9286f72` (phase 1). ForzaTune-
  aligned spec fields, dyno/telemetry auto-population.
- **Trail-braking bands + lap TB%** — commit `935bfe0`. Brake-trace shaded
  where braking + steering overlap.
- **Track map + elevation profile** — commit `d9b6bc1`. 2D path with color
  modes, multi-lap overlay, replay cursor.

---

## Locked phase plan (from philosophy 2026-05-21)

The build/tune artifact track now heads toward a single headline surface:

1. ~~Structured Build artifact~~ — ✅ shipped (`9286f72`)
2. ~~Structured Tune artifact~~ — ✅ shipped (`d21b15f`)
3. ~~Detector outputs as structured events~~ — **cut.** Language audit failed
   ("detector"/"event"/symptom names — lockup, wheelspin, past-grip). The
   intent (measurements for compare) is served by adding measurements lazily
   as Compare reveals gaps.
4. ~~Session-summary descriptive panel~~ — **cut for now.** Sat on top of #3;
   reconsider if Compare reveals a real need.
5. ~~Before/After Compare~~ — ✅ shipped (`e6a2f05`). Auto-pair on
   `(carId, eventId)`, measurement deltas + setup diff. New measurements
   get added when this surface reveals a gap, not speculatively.
6. ~~Telemetry-grounded `/tune/*` pages~~ — ✅ shipped (`9fcaab5` +
   `941fef6`). 11 per-slug bindings; drivetrain-aware. The "diff vs
   reference recommendation" subhint was deliberately dropped — pure
   measurements only, per the philosophy lock.
7. ~~Telemetry-grounded `/upgrade/*` pages~~ — ✅ shipped (`674afb9`).
   Scoped to 5 of 10 slugs after a philosophy check: only the upgrade
   categories where telemetry actually informs the decision get a
   binding. The other 5 either duplicate `/tune` bindings or have
   nothing meaningful to surface from the Car Dash packet.

---

## Explicitly cut (do not propose)

These came up in WISHLIST or competitor research and were rejected on
philosophy grounds. Keep them here so they don't get re-proposed.

- **Recommendation engine** — no symptom→fix rule database in code, no
  confidence algorithm, no conditional rules. The tool measures; the player
  decides; `/tune` and `/upgrade` are the only prescriptive surfaces.
- **Auto-tuning suggestion chips** — corner panel can say
  "UNDERSTEER → [/tune/anti-roll-bars]" but never "soften front ARB 2 clicks."
  Same reason.
- **Per-event-type rule calibration** — universal measurement; no style-
  specific advice. A rally driver intentionally slides, a circuit driver
  intentionally trail-brakes; same telemetry, opposite "right" answer.
- **Build-level diagnostics** ("power-to-tire ratio looks unusual") —
  requires peer data we don't have.
- **Subjective feedback layer** — v1 keeps the artifact objective.

---

## Carried over from DESIGN.md §5

- ~~Per-sector deltas~~ — ✅ shipped (`b262c90`). Equal-distance split
  version landed in the lap table. User-marked sector points on the
  map remain unbuilt and would supersede the equal-distance fallback
  if precision becomes important.
- **Suspension-travel markers on the map** — frames where
  `normalizedTravel > 0.95` rendered as map dots, paired with speed/steer at
  that frame. *Renamed from "Bottoming events" — observational, not
  diagnostic; the user decides if kerb-riding is intentional.* Originally v4
  slice 4.
- **Tire-temp distribution per lap** — temperature histogram (per tire),
  independent of the map. Originally v4 slice 4.
- **Hardware shift light** — USB serial bridge from Nitro to RP2040 /
  Arduino; LEDs map to `rpm / rpmMax`. Originally v5. Optional; the screen
  view must never depend on hardware.

---

## Measurement-side ideas (philosophy-aligned)

All neutral data-surfacing — no recommendations, no judgment in the copy.
Items tagged *(pro-tool standard)* came out of a 2026-05-21 survey of MoTeC
i2, Cosworth Pi Toolbox, AiM Race Studio, Coach Dave Delta, and the F1
telemetry literature. We adopt their *measurements*; we do not adopt their
prescriptive coaching layer.

### Low effort, high value

- **Coast-time aggregate** — time-in-state where
  `throttle < 0.05 AND brake < 0.05 AND |steer| > 0.1`. One filter over the
  existing frames blob. *Surface as "time-in-coast %," not "wasted lap
  time."*
- **Time-in-state aggregates per lap** — generalization of coast-time:
  % time on throttle, % on brake, % off both, % at full throttle, %
  cornering above N lateral G. Single component, many channels.
  *(pro-tool standard — AiM Channels Report, MoTeC reports.)*
- **Channels report table** — per-lap min / max / avg / p95 for every
  channel (and per sector once sectors exist). One reusable component for
  session-detail and Compare. *(pro-tool standard — MoTeC i2, AiM Race
  Studio ship this as a default panel.)*
- **Channel histograms per lap** — distribution view for throttle, brake,
  lateral G, slip. Surfaces *how often* a value is hit, not just peaks.
  Pairs with channels-report. *(pro-tool standard — MoTeC i2, AiM, Pi
  Toolbox.)*
- **Slip-angle balance channel** — front − rear slip-angle as a derived
  trace, rendered alongside the input traces. Surfaces understeer/oversteer
  *as a signal*, links to `/tune/anti-roll-bars` for the prescriptive read.
  *(pro-tool standard — MoTeC's predefined oversteer math channel.)*
- **Brake-trace shape metrics** — per-corner peak pressure, release
  steepness, onset slope. Surface as numbers next to the corner; do not
  surface as "double-peak detected" chips. *(pro-tool standard, framed
  philosophy-neutral.)*
- **Tune export / import** — JSON round-trip of `{ car, build, tune,
  settings }`. Now possible because the Tune artifact (phase 1b) shipped —
  the slider numbers exist as structured data. ForzaTune Pro's signature
  feature; we already have the artifact, just need the endpoint.
- ~~Apex-speed table~~ — ✅ shipped (`dafd0b4`) on `/compare` as
  per-sector minimum speed (A vs B vs delta). Approximates apex via
  equal-distance sector buckets rather than real corner detection —
  the latter would need curvature-based corner enumeration (still
  unbuilt, see below).
- ~~Best theoretical lap~~ — ✅ shipped (`355c542`) as part of `/hotlap`.
  Sum-of-best-sectors footer under the predicted/last/best row.
  Session-scoped only; not yet a column in the lap table — separate
  iteration if that becomes useful.
- **Ride-height histogram** on `/tune/ride-height` — reuses the
  `computeHistogram()` machinery from `a6b167f`, fed
  `suspensionMeters` instead of damper velocity. Single-pass swap;
  ~30 LOC. Surfaces how much time the chassis spends at each ride-
  height band over a session — pairs with the bottoming-percent
  number already on the page.

### Bigger lifts

- ~~Continuous delta-time vs distance~~ — ✅ shipped: math in `43ac856`
  (Δ TIME as the 4th `OverlayTraces` row, two-color split at zero,
  drag-zoom, Δ-at-finish header badge), headline promotion in
  `dafd0b4` (moved to top of stack at 2× height). Pairs with the new
  sector-delta and apex-speed tables on `/compare` for the
  "where time leaks" picture.
- **Damper velocity scatter** (position-vs-velocity X-Y plot) — the
  next-most-useful pro-tool suspension view after the histogram
  (`a6b167f`). Suspension position on X, velocity on Y; a "C" shape
  reveals imbalanced damping that the histogram alone can't surface.
  Same velocity calc as the histogram, new visualization.
- **Whole-lap G-G scatter on `/replay` and `/compare`** — `/live`'s
  G-G dot now shows the rolling ~20 s envelope (`c7e8d75`). What's
  still open: render every frame of a completed lap as a faded dot so
  the whole-lap envelope reads at a glance, plus A-vs-B G-G scatters
  side by side on `/compare`. Lap data path is already there; mostly a
  rendering + placement call (new dedicated component vs reuse the
  `CenterPanel` disc). *(pro-tool standard — friction circle is in
  every pro tool.)*
- **Friction-circle utilization channel** — instantaneous "% of theoretical
  friction circle used" as a derived trace. Pairs with the G-G trail.
  *(pro-tool standard — combined-slip math channel.)*
- **Pitch & roll math channels** — derived from suspension-travel deltas
  across axles. Surfaces chassis attitude we currently can't see directly.
  *(pro-tool standard — MoTeC ships these by discipline.)*
- **Ghost-lap overlay on `/live`** — best lap as a translucent silhouette
  alongside live. Bigger because `/live` doesn't currently render a map.
  Position-anchored rendering pattern proven. `utils/lap-reference.ts`
  (from `/hotlap`) is the reusable distance→clock interpolation —
  ghost-lap is now mostly a map-rendering exercise.
- **Multi-lap overlay (N > 2) on compare page** — current compare does 2
  traces (now with route overlay, sector + apex tables, and setup diff
  per `dafd0b4`). Going to N needs: `framesList: AlignFrame[][]` +
  `labels: string[]` on `OverlayTraces`, an array query param, a color
  palette generator, and a reference-lap picker so the delta channel
  isn't ambiguous with N−1 deltas. `align.ts` and TrackMap already
  generalise.
- **Race-stats aggregates** — sessions per car, hours per event, best by
  build/tune. Query work + cards. Independent of the map.

### Newly possible — unlocked by the track map

- **Track-map heatmaps** — same map, recoloured by slip / gear / lateral G /
  coast state. ~30 LOC per variant; each is a new color-mode chip on the
  existing TrackMap.
- **Event-level aggregate map** — overlay every session's path on
  `/events/:type/:id`. TrackMap supports multi-trace already; mostly server
  glue (unzip lap frame blobs, downsample to TrackPoint[] per lap) + a new
  endpoint.
- **Racing-line measurement** — `drivingLine` (s8 -128..127) is already
  decoded and the "line" color mode ships. Surface sustained deviation as a
  *measurement window* (not a chip that says "you're off-line").
- **Corner enumeration from curvature** — apex detection from path
  curvature, paired with speed minima. Same data, neutral naming —
  automatic corner indexing without `lap.distance` heuristics.

### Probably not worth it for our scope

- **Strategy calculator** (pit stops / fuel laps) — Horizon doesn't have
  real pit strategy.
- **Video sync** — heavy lift, off-axis.
- **Cloud sync / driver-vs-driver comparison** — explicitly cut in
  DESIGN.md §9.
- **Steering wheel HUD / iPad remote dashboards** — SimHub owns this. Our
  `/live` already works on any browser including iPad.
- **3D track maps** — 2D conveys enough for tuning decisions.

---

## The angle — what we measure that nobody else does

Everyone else either (a) does pure formulas with no telemetry input
(ForzaTune Pro), or (b) reads telemetry but hides the reasoning behind a
black-box recommendation (Tune It Yourself). Our niche is **glass-box
measurement**: "you changed the tune by X; here's what changed in your
data." `/tune` and `/upgrade` are the only prescriptive surfaces.
Everything else reports what happened and links to the relevant reference
page.

The locked phase plan makes **Before/After Compare** the headline
expression of this principle: same car, same event, two consecutive
sessions — tune diff + measurement diff, side by side. New measurements
get added when Compare reveals a gap, not speculatively.

---

## Language audit

When adding new features, vocabulary carries judgment. The "Phase 2
detector outputs" plan was rejected on this — words like *detector*,
*event*, *lockup*, *wheelspin*, *past grip* all presume the thing they
describe is unwanted. A rally driver intentionally has constant wheelspin;
a kerb-rider intentionally bottoms; a circuit driver intentionally locks
the inside wheel in a hairpin.

- ✗ Avoid: *detector*, *event*, *lockup*, *wheelspin*, *issue*, *problem*,
  *fix*, *should*, *optimal*, *best*, *recommended*, *wrong*
- ✓ Prefer: *measurement*, *aggregate*, *time-in-state*, *transient*,
  *your data*, *see [/tune/...]*

If a domain word is genuinely unavoidable (the trail-braking *detector*
file exists), surround it with copy that frames it as data, not diagnosis.
This applies to type names, feature names, and module names — not just
user-facing copy.

---

## Sources

- [Tune It Yourself] — live-telemetry tuning recommendations (black-box;
  our anti-niche)
- [Racing View] — FM telemetry + strategy app with dyno insights
- [ForzaTune Pro] — calculator-based, 1500+ cars, tune library
- [SimHub] — HUD overlay ecosystem
- [HorizonPlus] — Forza Horizon SimHub dashboard
- [MoTeC i2 + AiM-style analysis][motec]
- [Coach Dave Academy Delta][delta]
- [LMU Telemetry Lab][lmu]
- [FH6 Data Out docs][fh6dataout]

[Tune It Yourself]: https://www.tuneityourself.co.uk/
[Racing View]: https://www.racingview.app/
[ForzaTune Pro]: https://forzatune.com/
[SimHub]: https://www.simhubdash.com/community-2/dashboard-templates/
[HorizonPlus]: https://github.com/Sappytron/HorizonPlus
[motec]: https://www.fullgripmotorsport.com/telemetry
[delta]: https://coachdaveacademy.com/announcements/delta-data-telemetry-tool/
[lmu]: https://github.com/rabbit20031225/LMU-Telemetry-Lab
[fh6dataout]: https://support.forza.net/hc/en-us/articles/51744149102611-Forza-Horizon-6-Data-Out-Documentation
