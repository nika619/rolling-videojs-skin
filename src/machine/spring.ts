/** A damped spring for the mechanisms. Mutable on purpose: forty of them step every frame. */
export interface Spring {
  x: number;
  v: number;
}

export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Below this distance and speed a spring has arrived and is put exactly on its target. */
const REST = 0.002;
/** Longest integration step in seconds. Shorter steps keep stiff springs from exploding on a long frame. */
const MAX_STEP = 0.004;

/**
 * Step toward `target`. `omega` is the rate in rad/s, `zeta` the damping (1 settles without overshoot,
 * less swings past and back). Returns true while it is still moving.
 */
export function stepSpring(s: Spring, target: number, omega: number, zeta: number, dt: number): boolean {
  if (dt <= 0) return s.x !== target || s.v !== 0;

  const steps = Math.min(64, Math.ceil(dt / MAX_STEP));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - target)) * h;
    s.x += s.v * h;
  }

  if (Math.abs(s.x - target) < REST && Math.abs(s.v) < REST * omega) {
    s.x = target;
    s.v = 0;
    return false;
  }
  return true;
}

/** No travel: with reduced motion a mechanism is simply in its new state. */
export function snapSpring(s: Spring, target: number): boolean {
  s.x = target;
  s.v = 0;
  return false;
}
