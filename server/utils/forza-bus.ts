import { EventEmitter } from 'node:events'
import type { Telemetry } from './decode'

export interface DebugFrame {
  length: number
  // hex of the last 8 bytes — useful for mapping any padding/unknown trail
  tailHex: string
}

export type RecordingState
  = | { state: 'idle' }
    | {
      state: 'recording'
      sessionId: number
      eventId: number
      carOrdinal: number
      lapsCompleted: number
    }

export interface TunePrompt {
  sessionId: number
  carOrdinal: number
  previousPi: number
  currentPi: number
}

interface ForzaEvents {
  telemetry: [Telemetry]
  debug: [DebugFrame]
  recording_state: [RecordingState]
  tune_prompt: [TunePrompt]
}

class ForzaBus extends EventEmitter<ForzaEvents> {}

export const forzaBus = new ForzaBus()
forzaBus.setMaxListeners(50)
