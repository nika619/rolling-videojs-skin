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

/** How long a ring of this decay lasts before it is too small to draw: under half a percent. */
export const ringSpan = (decay: number): number => 5.3 / decay;

/**
 * A struck part ringing out: a decaying oscillation `t` seconds after the strike, zero before it and once it
 * has died away. Every reaction that shakes, trembles or wobbles is one of these.
 */
export function ring(t: number, freq: number, decay: number): number {
  return t < 0 || t > ringSpan(decay) ? 0 : Math.exp(-decay * t) * Math.sin(Math.PI * 2 * freq * t);
}

/** A pulse running along the rail at `speed` px a second: 1 at its front, falling off over `width` px either side. */
export function wave(t: number, distance: number, speed: number, width: number): number {
  if (t < 0 || !Number.isFinite(t)) return 0;
  const d = (distance - speed * t) / width;
  return d * d > 16 ? 0 : Math.exp(-d * d);
}

/** One rise and fall over `length` seconds: a blink, a hop, a flick. */
export const hump = (t: number, length: number): number => (t < 0 || t > length ? 0 : Math.sin((Math.PI * t) / length));
