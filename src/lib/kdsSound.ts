/**
 * KDS prep sound cues (MoM June-24; softened per client review 2026-07-08 —
 * "should be formal, not game-like") — synthesized with Web Audio, no audio
 * files. Mirrors the Dashboard.tsx `playBeep` approach (see src/pages/Dashboard.tsx):
 * lazily create an AudioContext per cue and close it on end. Every call fails
 * SILENTLY when Web Audio is unavailable or blocked (autoplay policy, SSR,
 * older browsers) — a missing sound must never break the board.
 *
 * Design constraints (client review): sine only, gain ≤ 0.08, ≤ 0.25 s, no
 * sweeps, no triangle "game" timbre. Sounds fire ONLY for order.created and
 * the PREPARING cue — never for warnings/errors.
 *
 * Two distinct cues so kitchen crew can tell them apart without looking:
 *   - `playNewOrderChime`  — a NEW order arrived: one soft 620 Hz tone
 *                            (identical to the Dashboard order.created tone).
 *   - `playFirePrepCue`    — an order advanced to PREPARING ("fire" the dish):
 *                            a very short, soft two-note (740 → 932 Hz) at
 *                            low gain — distinct, but equally subtle.
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

/** NEW order: single soft 620 Hz sine tone (matches Dashboard's order.created tone). */
export function playNewOrderChime(): void {
  withCtx(ctx => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(620, ctx.currentTime)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.012) // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.19) // ~0.18 s decay
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
    osc.onended = () => { void ctx.close() }
  })
}

/** PREPARING ("fire") cue: very short, soft two-note sine (740 → 932 Hz) —
 *  distinct from the single-tone chime but equally subtle. */
export function playFirePrepCue(): void {
  withCtx(ctx => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(740, ctx.currentTime)
    osc.frequency.setValueAtTime(932, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.012) // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22) // ≤0.25 s total
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.23)
    osc.onended = () => { void ctx.close() }
  })
}
