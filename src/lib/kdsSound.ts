/**
 * KDS prep sound cues (MoM June-24) — synthesized with Web Audio, no audio
 * files. Mirrors the Dashboard.tsx `playBeep` approach (see src/pages/Dashboard.tsx):
 * lazily create an AudioContext per cue and close it on end. Every call fails
 * SILENTLY when Web Audio is unavailable or blocked (autoplay policy, SSR,
 * older browsers) — a missing sound must never break the board.
 *
 * Two distinct cues so kitchen crew can tell them apart without looking:
 *   - `playNewOrderChime`  — a NEW order arrived (high, descending two-tone sine,
 *                            same "ding-dong" as the Dashboard order.created beep).
 *   - `playFirePrepCue`    — an order advanced to PREPARING ("fire" the dish):
 *                            a sharper rising triangle sweep.
 */

type AudioCtor = typeof AudioContext

function withCtx(fn: (ctx: AudioContext) => void): void {
  try {
    const Ctor = (window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext) as AudioCtor | undefined
    if (!Ctor) return
    const ctx = new Ctor()
    fn(ctx)
  } catch {
    // Web Audio unavailable or blocked — fail silently.
  }
}

/** NEW order: high, descending two-tone sine (matches Dashboard's order.created chime). */
export function playNewOrderChime(): void {
  withCtx(ctx => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)
    osc.onended = () => { void ctx.close() }
  })
}

/** PREPARING ("fire") cue: sharper rising triangle sweep — distinct from the chime. */
export function playFirePrepCue(): void {
  withCtx(ctx => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.22)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.32)
    osc.onended = () => { void ctx.close() }
  })
}
