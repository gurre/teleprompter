// Scroller eases the visible position toward a target. Everything that moves
// the prompter (the glide, going back to the top) moves the target; the text
// follows smoothly, so nothing on screen ever snaps.
const Scroller = (() => {
  const TAU = 0.25; // easing time constant in seconds
  const MAX_DT = 0.1; // cap so a stalled frame (hidden tab) cannot leap

  // step returns the state after dt seconds. State is { position, target,
  // max } in px; the target is kept within [0, max].
  function step(s, dt) {
    dt = Math.min(Math.max(dt, 0), MAX_DT);
    const target = clamp(s.target, 0, s.max);
    let position = s.position + (target - s.position) * (1 - Math.exp(-dt / TAU));
    if (Math.abs(target - position) < 0.05) position = target;
    return { ...s, position, target };
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  return { step, clamp, TAU };
})();

if (typeof module !== 'undefined') module.exports = Scroller;
