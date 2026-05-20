# Wishlist

Ideas worth building, ordered roughly by leverage. **Not a roadmap** — none of
these are commitments. The DESIGN.md doc closed on 2026-05-20 and any
open items from §5 plus everything found in subsequent competitor research
collected here. Treat this as the standing list to pick the next feature from
when there's no other priority.

Last refreshed 2026-05-20 (post-track-map).

---

## Recently shipped

- **Track map + elevation profile** — commit `d9b6bc1`. Top-down
  `(positionX, positionZ)` view with the per-lap elevation strip below
  it; color modes for speed / throttle / brake / driving-line; multi-lap
  overlay on session detail; moving cursor on both views during replay.
  Decoder also now reads `drivingLine` and `aiBrakeDifference` from the
  packet (offsets 321/322).

## Carried over from DESIGN.md §5

Items that were [todo] in the original roadmap and didn't ship:

- **Per-sector deltas** — derive sector boundaries from distance along the
  route, render sector times + delta vs reference. Originally v4 slice 3.
  *Now next-up; see [Newly possible](#newly-possible--unlocked-by-the-track-map).*
- **Bottoming-events list** — enumerate every frame where
  `normalizedTravel > 0.95`, with the speed/steer at that frame. Originally
  v4 slice 4. *Now becomes a markers-on-the-map view, not just a list.*
- **Tire-temp histogram per lap** — temperature distribution rather than
  the instantaneous heatmap. Originally v4 slice 4. Independent of the
  map.
- **Hardware shift light** — USB serial bridge from Nitro to a USB-attached
  RP2040 / Arduino; LEDs map to `rpm / rpmMax`. Originally v5. Optional;
  the screen view must never depend on hardware.

---

## From competitor research (2026-05-20)

Surveyed [Tune It Yourself], [Racing View], [ForzaTune Pro], [SimHub], [MoTeC
i2 / AiM-style analysis tools][motec], [Coach Dave Academy Delta][delta], and
[LMU Telemetry Lab][lmu]. The closest direct competitor is **Tune It Yourself**
— same approach (read UDP live, infer tunes), but iOS/Android only, paywalled,
black-box recommendations.

### Low effort, high value

- **Trail-braking detector** — overlap of brake decay + steer ramp. We have
  both signals already; one derived boolean (or shaded overlay on the
  brake trace) reveals a driving habit at a glance. Pro tools highlight
  this because brake-bias tuning advice depends on whether you
  trail-brake — and our `/tune/brakes` already says so in prose.
- **Coast-time analysis** — count frames where
  `throttle < 0.05 AND brake < 0.05 AND |steer| > 0.1`. Mid-corner with
  neither pedal engaged = wasted lap time. Every pro tool surfaces this.
  Cheap: it's one filter over the existing frames blob.
- **Tune export / import** — JSON round-trip of `{ car, tuneLabel, settings }`.
  ForzaTune Pro's signature feature is shareable tunes without accounts.
  We're already accountless; we just don't have a tune *artifact* yet —
  `tuneLabel` is just a string. Persist the actual numbers and export
  becomes one endpoint.
- **Apex-speed table** — per-corner minimum speed across laps. Trivial
  once we have sector / corner boundaries; useful for diagnosing
  corner-specific over/understeer.
- **Best theoretical lap** — sum-of-best-sectors. Standard feature in
  Racing View / Delta / MoTeC. Falls out of sector deltas.

### Bigger lifts

- **Ghost-lap overlay on `/live`** — replay your best lap as a translucent
  silhouette alongside live. Still a bigger lift because the on-screen
  *live* view doesn't currently render a map; the track map only shows up
  on session detail + replay. The position-anchored rendering pattern is
  now proven, so the remaining work is plumbing the map into `/live` and
  keeping it lightweight enough not to compete with the corner view.
- **Multi-lap overlay (N > 2) on compare page** — `/events/.../compare`
  does 2 lap traces. Pro tools do 5–7. The `align.ts` resampling
  generalises; TrackMap already takes `traces[]` with N entries on
  session detail. Easier than before now that the map proves the
  rendering pattern.
- **Auto-tuning suggestions** — Tune It Yourself's killer move and our
  natural moat. We have the symptom catalog in `/tune/diagnose`; the next
  step is running those rules in real time on the live data and surfacing
  "given the last 30 s, here are 2 likely fixes ranked by confidence."
  See "The angle" below. *Map makes the *where* of each suggestion
  visualisable — e.g. "you understeer at this corner specifically."*
- **Race-stats aggregates** — sessions per car, hours per event, best by
  tune. Racing View has it. All the data's in libsql; this is mostly
  query work + a few cards. Independent of the map.

### Newly possible — unlocked by the track map

The shipped TrackMap component proves the position-anchored rendering
pattern and already accepts arbitrary point overlays. These were either
gated on a 2D view or are dramatically cheaper now that one exists:

- **Sector deltas (the next obvious pick).** Two implementation paths now
  open: (a) equal-distance splits over `lap.distance` (one-liner over
  existing data); (b) user-marked sector points clicked directly on the
  rendered map and persisted per-event. Sector boundaries unlock the
  apex-speed table and the best-theoretical-lap headline number.
- **Track-map heatmaps** — same map, recolored by slip / gear / combined
  slip / lateral G. Each one is *literally* a new color-mode chip on the
  existing TrackMap. ~30 LOC per variant.
- **Bottoming-events as map markers** — render a red dot at every
  `(positionX, positionZ)` where suspension travel crossed 0.95. Turns
  the original "list of bottoming events" idea into a map-anchored
  visualisation; the list view can come along for the ride.
- **Event-level aggregate map** — overlay every session's path on
  `/events/:type/:id`. Already noted as deferred in the TrackMap plan;
  the component supports multi-trace already, so this is mostly server
  glue and a new endpoint mirroring `sessions/[id]/path.get.ts`.
- **Click-to-seek on the replay map** — click anywhere on the rendered
  track; the replay player jumps to the nearest frame by position. Today
  you scrub the trace strip, which is time-based — clicking by location
  reads more intuitively for "go to that corner."
- **Racing-line deviation chip / overlay** — now that the decoder reads
  `drivingLine` (s8 -128..127), we can colour the map by it (already
  shipped as the "line" mode) AND surface a diagnostic chip when
  deviation sustains over a window. Pairs naturally with the
  auto-tuning suggestion direction.
- **Corner-derived analysis** — apex detection from path curvature
  (segments where heading changes fastest). Together with speed minima
  this gives automatic corner enumeration without `lap.distance` heuristics.

### Probably not worth it for our scope

- **Strategy calculator** (pit stops / fuel laps) — Horizon doesn't have
  real pit strategy; FM-only. Not the game we target.
- **Video sync** — heavy lift, off-axis.
- **Cloud sync / driver-vs-driver comparison** — explicitly in DESIGN.md §9.
- **Steering wheel HUD / iPad remote dashboards** — [SimHub] owns this
  segment. Our `/live` already works on any browser including iPad; the
  unmet need is documentation, not code.
- **3D track maps** — 2D colored top-down conveys enough for tuning
  decisions. Pure ornament otherwise.

---

## The angle — where we'd actually be different

Everyone else either (a) does pure formulas with no telemetry input
(ForzaTune Pro), or (b) reads telemetry but hides the reasoning behind a
black-box recommendation (Tune It Yourself). Our existing structure —
diagnostic chips on the corner view linked to per-setting reference pages
under `/tune` — is already a glass-box version of (b). Two extensions
sharpen the moat:

1. **From diagnostic chips → suggestion chips.** Today a corner panel
   says "UNDERSTEER → [link to /tune/anti-roll-bars]". The next step is
   "UNDERSTEER · soften front ARB 2 clicks · [why]". The rule database is
   already in `app/utils/tuning-reference.ts`; we just need to evaluate
   the rules against the live data window.
2. **Telemetry-grounded `/tune` pages.** When a user reads "soften front
   ARB" on `/tune/anti-roll-bars`, embed a small panel showing *their*
   front-vs-rear slip averages from the last 5 laps. The advice gets
   calibrated to *this* car, not the generic textbook case.

Both turn the existing reference into a live, personalized diagnostic
without bolting on AI or breaking the local-first / no-account principle.

---

## When picking the next thing

Track map shipped 2026-05-20 (commit `d9b6bc1`). The natural next pick is
**per-sector deltas + the best-theoretical-lap headline number**. Two
follow-up directions, both attractive:

1. **Sector deltas (analytical depth).** Equal-distance splits first as
   the cheap default; user-marked boundaries on the map as the precise
   v2. Unlocks the apex-speed table and lets the compare page show
   per-sector delta time on the existing distance grid.
2. **Bottoming-events as map markers (visual depth).** Cheap, immediate,
   reads obviously — first time the tuning advice on `/tune/springs`
   becomes "this exact corner, this exact compression."

Both depend only on `lap.distance` (already on every frame) and the
TrackMap component (shipped). The "auto-tuning suggestions" angle from
the next section becomes much more compelling once sectors exist —
suggestions can then localise themselves ("you're losing 0.4 s in
sector 2; here's why").

---

## Sources

- [Tune It Yourself] — live-telemetry-driven tuning recommendations
- [Racing View] — FM telemetry + strategy app with dyno insights
- [ForzaTune Pro] — calculator-based, 1500+ cars, tune library
- [SimHub] — HUD overlay ecosystem
- [HorizonPlus] — Forza Horizon SimHub dashboard
- [MoTeC i2 + AiM-style analysis][motec]
- [Coach Dave Academy Delta][delta] — modern sim-racing delta tool
- [LMU Telemetry Lab][lmu] — 2D/3D maps, ghost car, lap comparison
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
