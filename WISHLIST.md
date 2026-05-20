# Wishlist

Ideas worth building, ordered roughly by leverage. **Not a roadmap** — none of
these are commitments. The DESIGN.md doc closed on 2026-05-20 and any
open items from §5 plus everything found in subsequent competitor research
collected here. Treat this as the standing list to pick the next feature from
when there's no other priority.

Last refreshed 2026-05-20.

---

## Carried over from DESIGN.md §5

Items that were [todo] in the original roadmap and didn't ship:

- **Track map** — plot `(PositionX, PositionZ)` colored by current speed.
  Originally v4 slice 2. Every other telemetry tool has this; it's the
  anchor visualization a lot of downstream features build on.
- **Per-sector deltas** — derive sector boundaries from distance along the
  route, render sector times + delta vs reference. Originally v4 slice 3.
- **Bottoming-events list** — enumerate every frame where
  `normalizedTravel > 0.95`, with the speed/steer at that frame. Originally
  v4 slice 4.
- **Tire-temp histogram per lap** — temperature distribution rather than
  the instantaneous heatmap. Originally v4 slice 4.
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

- **Ghost-lap overlay** — replay your best lap as a translucent silhouette
  alongside live. We have the data (frames blob per lap); we'd need a
  position-anchored render in the corner view.
- **Track-map heatmaps** — same map as the speed-colored one above, but
  recolored by throttle / brake / slip / gear. Each variant is cheap
  once the map exists.
- **Multi-lap overlay (N > 2)** — `/events/.../compare` does 2.
  Pro tools do 5–7. The `align.ts` resampling generalizes naturally.
- **Auto-tuning suggestions** — Tune It Yourself's killer move and our
  natural moat. We have the symptom catalog in `/tune/diagnose`; the next
  step is running those rules in real time on the live data and surfacing
  "given the last 30 s, here are 2 likely fixes ranked by confidence."
  See "The angle" below.
- **Race-stats aggregates** — sessions per car, hours per event, best by
  tune. Racing View has it. All the data's in libsql; this is mostly
  query work + a few cards.

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

The user signalled (2026-05-20) that if forced to pick one item next:
**track map + sector deltas together** (DESIGN.md slices 2 + 3). Most other
items on this list either depend on or strongly benefit from a 2D track
representation to anchor against.

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
