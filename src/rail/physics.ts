/**
 * Marble physics for the rail. One dimension, no library, pure functions:
 * the element owns time and pointers, this file owns how a steel ball moves.
 */

export type MarbleMode = 'follow' | 'drag' | 'glide';

export interface Marble {
  /** Position along the rail, 0 (lift) to 1 (bell). */
  readonly x: number;
  /** Velocity in rail lengths per second. */
  readonly v: number;
  /** Radians rolled so far. */
  readonly turn: number;
  readonly mode: MarbleMode;
}

export interface Rail {
  /** Distance between the rail ends in CSS pixels. */
  readonly length: number;
  /** Marble radius in CSS pixels. */
  readonly radius: number;
  /** Rolling friction, 1/s: how fast a flick dies away. */
  readonly friction: number;
  /** Share of speed kept after hitting an end stop, 0 to 1. */
  readonly restitution: number;
  /** Spring rate toward the playhead, rad/s. */
  readonly followOmega: number;
  /** Spring rate toward the pointer, rad/s. Stiffer, so the marble stays under the finger. */
  readonly dragOmega: number;
}

export interface MarbleInput {
  /** Where the film is, 0 to 1. */
  readonly target: number;
  /** Where the pointer is, 0 to 1, while dragging. */
  readonly pointer: number | null;
  /** No momentum, spin or spring: the marble is simply placed. */
  readonly reducedMotion: boolean;
}

export interface PointerSample {
  /** Seconds. */
  readonly t: number;
  /** Rail position, 0 to 1. */
  readonly x: number;
}

export const RAIL_FEEL = {
  friction: 2.4,
  restitution: 0.35,
  followOmega: 18,
  dragOmega: 70,
} as const;

/** Slower than this (rail lengths per second), a release is a placement, not a flick. */
export const FLICK_MIN_SPEED = 0.35;
/** A flick never throws the marble faster than this. */
export const FLICK_MAX_SPEED = 4;
/** Below this speed a gliding marble has come to rest. */
export const REST_SPEED = 0.015;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function createMarble(x = 0): Marble {
  return { x: clamp(x, 0, 1), v: 0, turn: 0, mode: 'follow' };
}

/**
 * Critically damped spring, solved exactly, so a long frame cannot make it overshoot or explode.
 * A jump in time becomes a quick roll instead of a teleport.
 */
export function springToward(
  x: number,
  v: number,
  target: number,
  omega: number,
  dt: number
): { x: number; v: number } {
  const offset = x - target;
  const decay = Math.exp(-omega * dt);
  const c = v + omega * offset;

  return { x: target + (offset + c * dt) * decay, v: (v - omega * c * dt) * decay };
}

/** Free roll with friction and a soft bounce off either end. Exact for any frame time between bounces. */
export function glide(x: number, v: number, dt: number, rail: Pick<Rail, 'friction' | 'restitution'>): { x: number; v: number } {
  const decay = Math.exp(-rail.friction * dt);
  let nextX = x + (v * (1 - decay)) / rail.friction;
  let nextV = v * decay;

  if (nextX < 0) {
    nextX = Math.min(1, -nextX * rail.restitution);
    nextV = -nextV * rail.restitution;
  } else if (nextX > 1) {
    nextX = Math.max(0, 1 - (nextX - 1) * rail.restitution);
    nextV = -nextV * rail.restitution;
  }

  return { x: nextX, v: nextV };
}

/** One step of the marble. Rolling without slipping: it turns exactly as far as it travels. */
export function stepMarble(marble: Marble, dt: number, input: MarbleInput, rail: Rail): Marble {
  const target = clamp(input.target, 0, 1);
  let { x, v, mode } = marble;

  if (dt <= 0) return marble;

  if (mode === 'drag' && input.pointer !== null) {
    const pointer = clamp(input.pointer, 0, 1);
    ({ x, v } = input.reducedMotion ? { x: pointer, v: 0 } : springToward(x, v, pointer, rail.dragOmega, dt));
  } else if (mode === 'glide' && !input.reducedMotion) {
    ({ x, v } = glide(x, v, dt, rail));
    if (Math.abs(v) < REST_SPEED) {
      v = 0;
      mode = 'follow';
    }
  } else {
    mode = mode === 'drag' ? 'drag' : 'follow';
    ({ x, v } = input.reducedMotion ? { x: target, v: 0 } : springToward(x, v, target, rail.followOmega, dt));
  }

  x = clamp(x, 0, 1);

  const travel = (x - marble.x) * rail.length;
  const turn = input.reducedMotion || rail.radius <= 0 ? marble.turn : marble.turn + travel / rail.radius;

  return { x, v, turn, mode };
}

/** The speed the pointer had when it let go, from its last tenth of a second. Rail lengths per second. */
export function flickVelocity(samples: readonly PointerSample[], now: number, windowSeconds = 0.1): number {
  const recent = samples.filter((sample) => now - sample.t <= windowSeconds);
  const first = recent[0];
  const last = recent[recent.length - 1];

  // A finger that paused before lifting has no fresh samples: that is a placement.
  if (!first || !last || last.t - first.t < 0.016 || now - last.t > 0.06) return 0;

  return clamp((last.x - first.x) / (last.t - first.t), -FLICK_MAX_SPEED, FLICK_MAX_SPEED);
}

export function isFlick(velocity: number, reducedMotion: boolean): boolean {
  return !reducedMotion && Math.abs(velocity) >= FLICK_MIN_SPEED;
}

/** Start gliding with the release speed. */
export function release(marble: Marble, velocity: number, reducedMotion: boolean): Marble {
  return isFlick(velocity, reducedMotion)
    ? { ...marble, v: velocity, mode: 'glide' }
    : { ...marble, v: 0, mode: 'follow' };
}

/** How far a flick will carry before friction stops it, ignoring the end stops. Rail lengths. */
export function glideDistance(velocity: number, friction: number): number {
  return velocity / friction;
}

/**
 * The knock against the pause pin: the marble bounces back off it and settles.
 * Returns pixels behind the pin (never positive, a pin is solid), `seconds` after the knock.
 */
export function rockOffset(seconds: number, amplitude: number): number {
  if (seconds <= 0 || seconds >= 1.2) return 0;

  return -amplitude * Math.exp(-5.5 * seconds) * Math.abs(Math.sin(Math.PI * 4.2 * seconds));
}

/**
 * The store reports time a few times a second. Between reports the film keeps moving,
 * so the playhead is carried forward at the playback rate (never more than half a second).
 */
export function playheadNow(
  reportedTime: number,
  secondsSinceReport: number,
  rate: number,
  playing: boolean,
  duration: number
): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;

  const carried = playing ? reportedTime + clamp(secondsSinceReport, 0, 0.5) * rate : reportedTime;

  return clamp(carried / duration, 0, 1);
}

export function isSettled(marble: Marble, target: number): boolean {
  return marble.mode === 'follow' && Math.abs(marble.x - clamp(target, 0, 1)) < 0.0004 && Math.abs(marble.v) < 0.002;
}
