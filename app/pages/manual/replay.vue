<script setup lang="ts">
useHead({ title: 'Manual · Replay' })
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Manual · Replay">
      <template #eyebrow>
        <NuxtLink
          to="/manual"
          class="hover:text-zinc-300"
        >
          Manual
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">Replay</span>
      </template>
      <template #intro>
        The replay player on session-detail pages lets you scrub through a
        finished lap frame-by-frame. Same live readouts as
        <NuxtLink
          to="/manual/live"
          class="text-green-300 hover:underline"
        >/live</NuxtLink>
        (CornerView, CenterPanel) plus whole-lap aggregate panels and
        trace strips you can drag-zoom.
      </template>
    </PageHeader>

    <ManualEntry
      id="damper-histogram"
      title="Damper velocity histogram"
      where="Below DynoCurve in the replay player · also on /tune/dampers (last 5 laps) and on /compare (A vs B)"
    >
      <template #intro>
        <p>
          Four small histograms (FL · FR · RL · RR) showing how much of
          the lap the suspension spent at each <em>damper velocity</em> —
          i.e. how fast the spring was moving at any given moment. The
          pro-tool standard view for damper tuning.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — damper
            velocity in mm/s. Center = 0; left of zero = rebound
            (extension), right of zero = bump (compression).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axis</span> — % of
            lap frames at that velocity (auto-scaled per chart).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Bar colors</span> —
            <span style="color:#e4e4e7">zinc</span> in the slow zone
            (|v| &lt; 25 mm/s),
            <span style="color:#fbbf24">amber</span> in the medium zone
            (25-50),
            <span style="color:#f97316">orange</span> in the fast zone
            (|v| &gt; 50).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Dashed horizontal line</span>
            at 12 % — pro reference for the ideal cone peak height.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Zone row below each chart</span>
            — time-share of the lap in each velocity zone:
            <span class="font-mono">F·reb</span> /
            <span class="font-mono">S·reb</span> /
            <span class="font-mono">S·bump</span> /
            <span class="font-mono">F·bump</span>.
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Symmetric cone, peak ~12 % at 0
              </td>
              <td class="py-2 text-zinc-400">
                Dampers are balanced.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Tall, narrow peak (well above 12 %)
              </td>
              <td class="py-2 text-zinc-400">
                Dampers too stiff — suspension barely moving.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Wide, low cone (peak below 12 %)
              </td>
              <td class="py-2 text-zinc-400">
                Dampers too soft — suspension moves too freely.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Skewed toward the bump side (right)
              </td>
              <td class="py-2 text-zinc-400">
                Too much rebound damping — spring not extending freely.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Skewed toward the rebound side (left)
              </td>
              <td class="py-2 text-zinc-400">
                Too much bump damping — spring not compressing freely.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                High fast-zone % (orange bars dominate the edges)
              </td>
              <td class="py-2 text-zinc-400">
                Bumpy surface, kerb hits, or under-damped fast events.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                FL vs FR (or RL vs RR) shapes differ
              </td>
              <td class="py-2 text-zinc-400">
                Side-to-side imbalance (camber, pressure, bump-steer).
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Fronts vs rears differ
              </td>
              <td class="py-2 text-zinc-400">
                Front/rear damping balance issue.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        <NuxtLink
          to="/tune/dampers"
          class="text-green-300 hover:underline"
        >/tune/dampers</NuxtLink>
        ·
        <NuxtLink
          to="/tune/springs"
          class="text-green-300 hover:underline"
        >/tune/springs</NuxtLink>
        · the real-time damper bar on
        <NuxtLink
          to="/manual/live#spring-damper"
          class="text-green-300 hover:underline"
        >each CornerPanel</NuxtLink>
        is the same signal sampled instantaneously.
      </template>
    </ManualEntry>

    <ManualEntry
      id="damper-scatter"
      title="Damper position × velocity scatter"
      where="Below the damper histogram in the replay player · also on /tune/dampers and on /compare (A vs B)"
    >
      <template #intro>
        <p>
          Four scatter plots (FL · FR · RL · RR), one dot per sampled frame,
          plotting <em>where</em> the suspension sat against <em>how fast</em>
          it was moving at that instant. The histogram tells you how often a
          velocity was hit; this tells you how that velocity couples with
          travel — the next pro-tool view after the histogram.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — suspension
            travel, <em>droop</em> (left — spring fully extended, wheel
            hanging, no load) → <em>bottomed</em> (right — spring fully
            compressed, out of travel). Dashed vertical line marks the 0.95
            bottoming threshold.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axis</span> — damper
            velocity, ±250 mm/s. Above the centerline = bump (compression),
            below = rebound (extension).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Dots</span> — faint and
            overlapping; density is the signal. The cloud is decimated to a
            representative sample, not every frame.
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Symmetric blob around the center
              </td>
              <td class="py-2 text-zinc-400">
                Bump and rebound are balanced through the travel range.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                "C" shape leaning to one side
              </td>
              <td class="py-2 text-zinc-400">
                Bump/rebound coupling differs across travel — the imbalance
                the histogram alone can't surface.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Cloud shifted to the right
              </td>
              <td class="py-2 text-zinc-400">
                Car spends its time low in the travel range — near the
                bottoming line.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Tall vertical spread at one position
              </td>
              <td class="py-2 text-zinc-400">
                Fast events (kerbs, bumps) at that ride height.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        <NuxtLink
          to="/manual/replay#damper-histogram"
          class="text-green-300 hover:underline"
        >the damper histogram</NuxtLink>
        is the distribution of this plot's Y axis; together they cover
        <NuxtLink
          to="/tune/dampers"
          class="text-green-300 hover:underline"
        >/tune/dampers</NuxtLink>.
      </template>
    </ManualEntry>

    <ManualEntry
      id="ride-height-histogram"
      title="Ride-height histogram"
      where="Below the damper scatter in the replay player · also on /tune/ride-height (last 5 laps) and on /compare (A vs B)"
    >
      <template #intro>
        <p>
          Four histograms (FL · FR · RL · RR) showing how much of the lap each
          corner spent at each <em>suspension-travel band</em> — i.e. where the
          chassis sat. The position-domain companion to the damper histogram.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — normalized
            travel, <em>droop</em> (left — spring fully extended, wheel
            hanging, no load) → <em>bottomed</em> (right — spring fully
            compressed, out of travel). Dashed vertical line marks the 0.95
            bottoming threshold.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axis</span> — % of lap
            frames in that band (auto-scaled per chart).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Band row below each chart</span>
            — time-share split into
            <span class="font-mono">droop</span> (≤25 %),
            <span class="font-mono">mid</span> (25-75 %),
            <span class="font-mono">comp</span> (75-95 %),
            <span class="font-mono">bottom</span> (&gt;95 %). The
            <span class="font-mono">bottom</span> figure matches the bottoming
            % on /tune/ride-height.
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars piled to the left
              </td>
              <td class="py-2 text-zinc-400">
                Car rides high / lightly loaded.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars piled to the right, into the bottoming band
              </td>
              <td class="py-2 text-zinc-400">
                Car rides low — the aero platform is near the floor.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                FL vs FR (or RL vs RR) distributions differ
              </td>
              <td class="py-2 text-zinc-400">
                Left/right load asymmetry.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Fronts sit deeper than rears
              </td>
              <td class="py-2 text-zinc-400">
                Forward load bias — pairs with the front/rear travel averages.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        <NuxtLink
          to="/tune/ride-height"
          class="text-green-300 hover:underline"
        >/tune/ride-height</NuxtLink>
        ·
        <NuxtLink
          to="/tune/springs"
          class="text-green-300 hover:underline"
        >/tune/springs</NuxtLink>
      </template>
    </ManualEntry>

    <ManualEntry
      id="slip-angle-balance"
      title="Slip-angle balance (understeer / oversteer)"
      where="Below the ride-height histogram on the replay player · also on /tune/anti-roll-bars and on /compare (A vs B)"
    >
      <template #intro>
        <p>
          A signed histogram of (front − rear) absolute slip-angle magnitude
          per frame, in degrees. Lap-scale chassis balance read — answers
          <em>did this lap lean understeery or oversteery overall</em>, no
          per-frame view does.
        </p>
        <p class="mt-2 text-zinc-400">
          Cornering-only: frames with lateral acceleration under 2 m/s²
          (~0.2 g) are dropped so straight-line "everything near zero" doesn't
          swamp the center.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — front−rear
            slip angle, signed degrees. Symmetric range −12° to +12°.
          </li>
          <li>
            <span class="font-mono text-zinc-100">0 divider</span> — splits
            <span style="color:#38bdf8">oversteer (left, sky)</span>
            from
            <span style="color:#fbbf24">understeer (right, amber)</span>.
            Sign convention: front slipping more than rear = positive =
            understeer.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axis</span> — % of
            cornering frames in that band (auto-scaled).
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Tall peak right at 0
              </td>
              <td class="py-2 text-zinc-400">
                Chassis is balanced through the lap.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars piled right of 0
              </td>
              <td class="py-2 text-zinc-400">
                Lap leaned understeery — fronts working harder than rears.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars piled left of 0
              </td>
              <td class="py-2 text-zinc-400">
                Lap leaned oversteery — rears working harder than fronts.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Wide spread either side
              </td>
              <td class="py-2 text-zinc-400">
                Balance shifts through corners — entry vs mid vs exit
                behaving differently.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        <NuxtLink
          to="/tune/anti-roll-bars"
          class="text-green-300 hover:underline"
        >/tune/anti-roll-bars</NuxtLink>
        ·
        <NuxtLink
          to="/tune/alignment"
          class="text-green-300 hover:underline"
        >/tune/alignment</NuxtLink>
        ·
        <NuxtLink
          to="/tune/springs"
          class="text-green-300 hover:underline"
        >/tune/springs</NuxtLink>
      </template>
    </ManualEntry>

    <ManualEntry
      id="track-map"
      title="Track map · single-trace mode"
      where="Bottom of the replay player"
    >
      <template #intro>
        <p>
          Top-down view of the lap path in world coordinates. The cursor
          dot tracks your scrub position; click anywhere on the route to
          jump there.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">Axes</span> — world (X, Z)
            ground-plane coordinates. Orientation matches the in-game map.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Color-mode chips</span>
            (top right) — recolor the line by
            <span class="font-mono">speed</span> /
            <span class="font-mono">throttle</span> /
            <span class="font-mono">brake</span> /
            <span class="font-mono">line</span> (driving-line deviation).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Start marker</span> —
            small green dot at lap-distance = 0.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Cursor dot</span> — white
            dot at your current scrub position.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Click anywhere on the route</span>
            — replay jumps to the nearest frame.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Elevation strip</span> —
            Y (height) over lap distance below the map. Δ shows total
            elevation range.
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Smooth color gradient in speed mode
              </td>
              <td class="py-2 text-zinc-400">
                Hot colors on straights, cool at corner apexes — normal.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Brake mode shows red far from corners
              </td>
              <td class="py-2 text-zinc-400">
                Mid-corner braking — often a setup or confidence issue.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Line-mode bands away from neutral
              </td>
              <td class="py-2 text-zinc-400">
                Sustained off-line driving compared to the in-game
                reference line.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        On
        <NuxtLink
          to="/manual/compare#track-map"
          class="text-green-300 hover:underline"
        >/compare</NuxtLink>
        the same component renders both laps' routes side-by-side with
        fixed legend colors instead of a single recolored line.
      </template>
    </ManualEntry>

    <ManualEntry
      id="dyno-curve"
      title="Dyno curve · this lap so far"
      where="Between TraceStrip (motor) and TrackMap in the replay player"
    >
      <template #intro>
        <p>
          Power, torque, and (when forced induction is detected) boost
          curves, plotted against RPM and growing as you scrub through the
          lap. Identical math to
          <NuxtLink
            to="/dyno"
            class="text-green-300 hover:underline"
          >/dyno</NuxtLink>'s
          session-wide curve, just constrained to one lap.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — engine
            RPM, idle to max.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axes</span> — each line
            scaled to its own peak (so torque and power can share the
            view despite different units).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Cyan</span> = torque,
            <span class="font-mono">purple</span> = power,
            <span class="font-mono">amber</span> = boost (when applicable).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Grows as you scrub</span>
            — bins frames up to the current playback index. Late in the
            lap the curve is smoother because more samples fill the bins.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Detailed mode (replay default)</span>
            — adds a shaded powerband (RPM range within 90 % of peak
            torque), a shift-point marker at the peak-power RPM, and a
            live needle that tracks the scrub position. The needle's
            position vs the powerband shading tells you whether you were
            on or off the band at any given moment.
          </li>
        </ul>
      </template>
      <template #seeAlso>
        <NuxtLink
          to="/dyno"
          class="text-green-300 hover:underline"
        >/dyno</NuxtLink>
        for the session-wide version (more samples, smoother curve), the
        <a
          href="#rpm-histogram"
          class="text-green-300 hover:underline"
        >RPM histogram</a>
        below for where time was actually spent, and
        <NuxtLink
          to="/tune/gearing"
          class="text-green-300 hover:underline"
        >/tune/gearing</NuxtLink>
        for what to do with the powerband shape.
      </template>
    </ManualEntry>

    <ManualEntry
      id="rpm-histogram"
      title="RPM distribution"
      where="Below the dyno on the replay player · also on /tune/gearing (last 5 laps)"
    >
      <template #intro>
        <p>
          Where the engine spent its time over the lap. The dyno shows what
          the engine <em>can produce</em> at each RPM; this shows where you
          actually <em>were</em>. Together they answer the gearing question.
        </p>
      </template>
      <template #how>
        <ul class="list-disc space-y-1.5 pl-5">
          <li>
            <span class="font-mono text-zinc-100">X axis</span> — RPM, 0 to
            the redline rounded up to the next 1000. Twelve even bins.
          </li>
          <li>
            <span class="font-mono text-zinc-100">Y axis</span> — % of lap
            frames in that band (auto-scaled).
          </li>
          <li>
            <span class="font-mono text-zinc-100">Pairs with the dyno above</span>
            — eyeball the histogram peak against where the dyno's powerband
            sits.
          </li>
        </ul>
      </template>
      <template #shapes>
        <table class="w-full text-sm">
          <tbody class="divide-y divide-zinc-800/60">
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Peak roughly aligned with the dyno's peak-torque band
              </td>
              <td class="py-2 text-zinc-400">
                Gearing is matched to the engine.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars piled well below the powerband
              </td>
              <td class="py-2 text-zinc-400">
                Engine spends time under-revved — gearing tall or shifts
                early.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bars stacked at the redline
              </td>
              <td class="py-2 text-zinc-400">
                Bouncing off the limiter — gearing short or shifts late.
              </td>
            </tr>
            <tr>
              <td class="py-2 pr-4 font-mono text-zinc-100">
                Bimodal (two peaks)
              </td>
              <td class="py-2 text-zinc-400">
                Cruising in one gear and accelerating in another for big
                stretches of the lap.
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #seeAlso>
        <a
          href="#dyno-curve"
          class="text-green-300 hover:underline"
        >Dyno curve above</a>
        ·
        <NuxtLink
          to="/tune/gearing"
          class="text-green-300 hover:underline"
        >/tune/gearing</NuxtLink>
      </template>
    </ManualEntry>

    <p class="text-xs text-zinc-500">
      The G-G scatter, friction circles, spring &amp; damper gauges, and
      input strips inside the live panels are described on
      <NuxtLink
        to="/manual/live"
        class="text-green-300 hover:underline"
      >/manual/live</NuxtLink>
      — same components, same readings. On `/replay` they're driven by the
      scrubbed frame instead of live telemetry, but everything else
      behaves the same way.
    </p>
  </main>
</template>
