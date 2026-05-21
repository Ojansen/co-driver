# Wishlist

Ideas worth building. **Not a roadmap** — none of these are commitments.
Filtered through the locked tool philosophy (2026-05-21): forza-data is a
personal tuning instrument; **measurement-not-prescription**; player-centric
language; build and tune as separate layers; the loop is tune-and-measure
with `/tune/*` and `/upgrade/*` as the only prescriptive surfaces.

Last refreshed 2026-05-21 (post-`/upgrade`, post-philosophy lock).

---

## Recently shipped

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
5. **Before/After Compare — HEADLINE, next up.** Auto-pair the current
   session with the most recent prior session on the same car/event. Surface
   tune diff (via `diffSetup`) + measurement diff (best lap, trail-brake
   ratio, peak power). Add new measurements only when this surface asks for
   them. *In progress — see uncommitted `SessionCompare.vue` /
   `setup-diff.ts` / `compare.get.ts` in working tree.*
6. **Telemetry-grounded `/tune/*` and `/upgrade/*` pages.** "Your data"
   panel alongside the generic advice on each reference page — front-vs-rear
   slip averages from the last 5 laps next to "stiffen rear ARB," PWR from
   the actual car next to the engine-swap decision rule, etc.

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

- **Per-sector deltas** — equal-distance splits over `lap.distance` (cheap)
  or user-marked sector points on the map (precise). Sector boundaries
  unlock apex-speed and best-theoretical-lap. Originally v4 slice 3; still
  unbuilt and still attractive.
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
- **Apex-speed table** — per-corner minimum speed across laps. Falls out of
  sector boundaries. *(pro-tool standard.)*
- **Best theoretical lap** — sum-of-best-sectors. Falls out of sector
  deltas. *(pro-tool standard headline number.)*

### Bigger lifts

- **Continuous delta-time vs distance** — pick two laps, plot cumulative
  Δt along the distance axis. The single highest-leverage pro graph we
  don't have today — pros reach for it before sector deltas. Distinct from
  per-sector deltas (which are discrete bins); this shows the *shape* of
  where time leaks. Builds naturally on top of the existing `align.ts`
  resample. *(pro-tool standard — Coach Dave Delta's namesake graph; in
  every MoTeC / Pi Toolbox / AiM workflow.)*
- **G-G trail / scatter** — extend the current single-instant G-G dot on
  the corner panel to a scatter of the last N seconds (live) or all frames
  in a lap (replay / session detail). The *shape* of the trace is the
  measurement — a smooth arc from top to side is trail-braking visible at
  a glance, without saying so in copy. *(pro-tool standard — friction
  circle is in every pro tool.)*
- **Differential cursor on TraceStrip** — drop two cursors anywhere on a
  trace; surface Δt and Δchannel between them. Interaction upgrade on the
  existing component; turns every trace into an ad-hoc measurement tool.
  *(pro-tool standard — hallmark of MoTeC i2.)*
- **Friction-circle utilization channel** — instantaneous "% of theoretical
  friction circle used" as a derived trace. Pairs with the G-G trail.
  *(pro-tool standard — combined-slip math channel.)*
- **Pitch & roll math channels** — derived from suspension-travel deltas
  across axles. Surfaces chassis attitude we currently can't see directly.
  *(pro-tool standard — MoTeC ships these by discipline.)*
- **Ghost-lap overlay on `/live`** — best lap as a translucent silhouette
  alongside live. Bigger because `/live` doesn't currently render a map.
  Position-anchored rendering pattern proven.
- **Multi-lap overlay (N > 2) on compare page** — current compare does 2
  traces; `align.ts` and TrackMap already generalise. Currently in progress
  in the working tree.
- **Race-stats aggregates** — sessions per car, hours per event, best by
  build/tune. Query work + cards. Independent of the map.

### Newly possible — unlocked by the track map

- **Track-map heatmaps** — same map, recoloured by slip / gear / lateral G /
  coast state. ~30 LOC per variant; each is a new color-mode chip on the
  existing TrackMap.
- **Event-level aggregate map** — overlay every session's path on
  `/events/:type/:id`. TrackMap supports multi-trace already; mostly server
  glue + an endpoint mirroring `sessions/[id]/path.get.ts`.
- **Click-to-seek on the replay map** — click anywhere on the rendered
  track; replay jumps to the nearest frame by position. More intuitive than
  time-based trace-strip scrubbing for "go to that corner."
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
