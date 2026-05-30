<script setup lang="ts">
const props = defineProps<{
  /** body-frame longitudinal acceleration (m/s²) — +ve forward */
  accelLong: number
  /** body-frame lateral acceleration (m/s²) — +ve to one side */
  accelLat: number
}>()

// 2g range on each axis. Matches Forza's in-game G meter: braking plots UP
// (driver felt forward), accelerating plots DOWN (driver pushed back into seat).
const G_RANGE_MPS2 = 20

// Trail rendered as a fading scatter — pros read the *envelope* (density
// across the disc), not the path. Decimate to ~10 Hz so 200 dots cover ~20 s
// of history; the instantaneous "now" dot still updates at 60 Hz from props.
//
// The trail + now dot are drawn on a <canvas>, NOT as SVG nodes: at 200 dots
// the SVG version repainted 200 elements (plus a Gaussian-blur filter on the
// moving dot) every frame, which is exactly when the live view started to
// stutter — the scatter saturates at 200 nodes around the 20 s mark
// (200 ÷ 10 Hz). Canvas draws the whole frame in one paint op with no
// per-node compositing and no filter re-rasterization. Only the static chrome
// (rings, crosshair, labels) stays as SVG since it never repaints.
const TRAIL_SAMPLES = 200
const TRAIL_DECIMATE = 6
const TAU = Math.PI * 2

interface GPoint { x: number, y: number }
// Plain (non-reactive) ring — the canvas reads it directly in draw(), so it
// doesn't need to be a ref. Avoids proxying 200 points + spurious re-renders.
const trail: GPoint[] = []
let frameCounter = 0

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// Acceleration → 0..100 plot coordinates (matches the SVG viewBox).
function ggDot(): GPoint {
  const xs = 50 + clamp(props.accelLat / G_RANGE_MPS2, -1, 1) * 48
  const ys = 50 + clamp(props.accelLong / G_RANGE_MPS2, -1, 1) * 48
  return { x: xs, y: ys }
}

const dotPos = computed<GPoint>(() => ggDot())
const lateralG = computed(() => props.accelLat / 9.81)
const longG = computed(() => props.accelLong / 9.81)

function signedFixed(v: number, digits: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(digits)
}

// --- canvas dynamic layer -------------------------------------------------
const canvasEl = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let resizeObs: ResizeObserver | null = null

// Size the backing store to the element's CSS box × devicePixelRatio so the
// dots stay crisp on hi-dpi screens. The draw transform maps the 0..100 plot
// space onto the full canvas.
function resize(): void {
  const el = canvasEl.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const css = el.clientWidth || 100
  el.width = Math.max(1, Math.round(css * dpr))
  el.height = Math.max(1, Math.round(css * dpr))
  ctx = el.getContext('2d')
}

function draw(): void {
  const c = ctx
  const el = canvasEl.value
  if (!c || !el) return
  const s = el.width // square backing store, device px
  c.setTransform(s / 100, 0, 0, s / 100, 0, 0) // draw in 0..100 plot space
  c.clearRect(0, 0, 100, 100)

  // Envelope scatter — opacity ramps from oldest (~invisible) to newest so
  // density carries the visual weight.
  const len = trail.length
  c.fillStyle = '#fbbf24'
  for (let i = 0; i < len; i++) {
    const p = trail[i]!
    c.globalAlpha = ((i + 1) / len) * 0.55
    c.beginPath()
    c.arc(p.x, p.y, 0.75, 0, TAU)
    c.fill()
  }
  c.globalAlpha = 1

  // Current point — soft radial glow (cheap canvas stand-in for the old SVG
  // Gaussian blur) plus a solid core.
  const d = dotPos.value
  const glow = c.createRadialGradient(d.x, d.y, 0, d.x, d.y, 6)
  glow.addColorStop(0, 'rgba(34, 197, 94, 0.45)')
  glow.addColorStop(1, 'rgba(34, 197, 94, 0)')
  c.fillStyle = glow
  c.beginPath()
  c.arc(d.x, d.y, 6, 0, TAU)
  c.fill()

  c.fillStyle = '#4ade80'
  c.beginPath()
  c.arc(d.x, d.y, 3, 0, TAU)
  c.fill()
  c.lineWidth = 0.6
  c.strokeStyle = '#0f0f12'
  c.stroke()
}

// Driven by accel changes — once per paint after the upstream rAF coalescing.
watch(() => [props.accelLat, props.accelLong] as const, () => {
  frameCounter++
  if (frameCounter % TRAIL_DECIMATE === 0) {
    trail.push(ggDot())
    if (trail.length > TRAIL_SAMPLES) trail.shift()
  }
  draw()
})

onMounted(() => {
  resize()
  draw()
  const el = canvasEl.value
  if (el) {
    resizeObs = new ResizeObserver(() => {
      resize()
      draw()
    })
    resizeObs.observe(el)
  }
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  resizeObs = null
})
</script>

<template>
  <div class="relative">
    <svg
      viewBox="0 0 100 100"
      class="aspect-square w-full"
    >
      <defs>
        <radialGradient id="ggBackdrop">
          <stop
            offset="0%"
            stop-color="#0f0f12"
          />
          <stop
            offset="100%"
            stop-color="#18181b"
          />
        </radialGradient>
      </defs>

      <!-- backdrop -->
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="url(#ggBackdrop)"
        stroke="#3f3f46"
        stroke-width="0.6"
      />
      <!-- crosshair -->
      <line
        x1="50"
        y1="3"
        x2="50"
        y2="97"
        stroke="#52525b"
        stroke-width="0.4"
      />
      <line
        x1="3"
        y1="50"
        x2="97"
        y2="50"
        stroke="#52525b"
        stroke-width="0.4"
      />
      <!-- 1g ring (inner) and 2g ring (outer) -->
      <circle
        cx="50"
        cy="50"
        r="24"
        fill="none"
        stroke="#52525b"
        stroke-width="0.4"
        stroke-dasharray="2,2"
      />
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="#3f3f46"
        stroke-width="0.4"
        stroke-dasharray="1,2"
      />
      <!-- axis ticks at 1g and 2g -->
      <g
        stroke="#52525b"
        stroke-width="0.5"
      >
        <line
          x1="26"
          y1="48"
          x2="26"
          y2="52"
        />
        <line
          x1="74"
          y1="48"
          x2="74"
          y2="52"
        />
        <line
          x1="48"
          y1="26"
          x2="52"
          y2="26"
        />
        <line
          x1="48"
          y1="74"
          x2="52"
          y2="74"
        />
      </g>
      <!-- ring labels -->
      <text
        x="50"
        y="28.5"
        text-anchor="middle"
        fill="#52525b"
        font-size="3.2"
        font-family="monospace"
      >1g</text>
      <text
        x="50"
        y="4.5"
        text-anchor="middle"
        fill="#3f3f46"
        font-size="3.2"
        font-family="monospace"
      >2g</text>
    </svg>

    <!-- Dynamic layer: trail envelope + current point. Overlays the static
         SVG chrome exactly (both fill the square box). -->
    <canvas
      ref="canvasEl"
      class="pointer-events-none absolute inset-0 h-full w-full"
    />

    <div class="absolute top-2 left-2 text-xs uppercase tracking-[0.25em] text-zinc-500">
      G-G
    </div>
    <div class="absolute right-2 bottom-2 font-mono text-xs tabular-nums text-zinc-300">
      {{ signedFixed(lateralG, 2) }} <span class="text-zinc-500">·</span> {{ signedFixed(longG, 2) }} <span class="text-zinc-500">g</span>
    </div>
  </div>
</template>
