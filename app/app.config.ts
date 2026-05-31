export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc'
    },
    // Encode the app's terminal/mono aesthetic on the form primitives so
    // U-components inherit it without per-instance overrides: compact
    // rounded-sm corners, monospaced text, and the dark inset field bg.
    input: {
      slots: { base: 'rounded-sm font-mono bg-zinc-950' }
    },
    textarea: {
      slots: { base: 'rounded-sm font-mono bg-zinc-950' }
    },
    select: {
      slots: { base: 'rounded-sm font-mono bg-zinc-950' }
    },
    selectMenu: {
      slots: { base: 'rounded-sm font-mono bg-zinc-950' }
    },
    button: {
      slots: { base: 'rounded-sm' }
    }
  }
})
