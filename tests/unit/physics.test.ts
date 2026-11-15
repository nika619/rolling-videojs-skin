import { describe, expect, it } from 'vitest';

import {
  createMarble,
  FLICK_MAX_SPEED,
  flickVelocity,
  glide,
  glideDistance,
  isFlick,
  isSettled,
  type Marble,
  type MarbleInput,
  playheadNow,
  RAIL_FEEL,
  type Rail,
  release,
  rockOffset,
  springToward,
  stepMarble,
} from '../../src/rail/physics';

const rail: Rail = { length: 800, radius: 10, ...RAIL_FEEL };
const follow = (target: number, reducedMotion = false): MarbleInput => ({ target, pointer: null, reducedMotion });

function run(marble: Marble, seconds: number, input: MarbleInput, dt = 1 / 60): Marble {
  let next = marble;
  for (let t = 0; t < seconds; t += dt) next = stepMarble(next, dt, input, rail);
  return next;
}

describe('springToward', () => {
  it('reaches the target without overshooting', () => {
    let state = { x: 0, v: 0 };
    let highest = 0;

    for (let i = 0; i < 120; i++) {
      state = springToward(state.x, state.v, 1, 18, 1 / 60);
      highest = Math.max(highest, state.x);
    }

    expect(state.x).toBeCloseTo(1, 4);
    expect(highest).toBeLessThanOrEqual(1);
  });

  it('gives the same answer in one long step as in many short ones', () => {
    const once = springToward(0.2, 0.5, 0.9, 18, 0.25);
    let many = { x: 0.2, v: 0.5 };
    for (let i = 0; i < 250; i++) many = springToward(many.x, many.v, 0.9, 18, 0.001);

    expect(once.x).toBeCloseTo(many.x, 6);
    expect(once.v).toBeCloseTo(many.v, 5);
  });

  it('stays finite after a frame as long as a sleeping tab', () => {
    const state = springToward(0, 3, 1, 70, 30);

    expect(state.x).toBeCloseTo(1, 6);
    expect(Number.isFinite(state.v)).toBe(true);
  });
});

describe('follow', () => {
  it('rolls to a new time instead of teleporting', () => {
    const start = createMarble(0.1);
    const afterOneFrame = stepMarble(start, 1 / 60, follow(0.8), rail);
    const later = run(start, 1, follow(0.8));

    expect(afterOneFrame.x).toBeGreaterThan(0.1);
    expect(afterOneFrame.x).toBeLessThan(0.3);
    expect(later.x).toBeCloseTo(0.8, 3);
    expect(isSettled(later, 0.8)).toBe(true);
  });

  it('is placed directly when reduced motion is on, without spin', () => {
    const next = stepMarble(createMarble(0.1), 1 / 60, follow(0.8, true), rail);

    expect(next.x).toBe(0.8);
    expect(next.v).toBe(0);
    expect(next.turn).toBe(0);
  });
});

describe('rolling without slipping', () => {
  it('turns exactly as far as it travels', () => {
    const end = run(createMarble(0), 2, follow(0.5));

    expect(end.turn).toBeCloseTo((end.x * rail.length) / rail.radius, 6);
  });

  it('unwinds when it rolls back', () => {
    const out = run(createMarble(0), 2, follow(0.5));
    const back = run(out, 2, follow(0));

    expect(back.turn).toBeCloseTo(0, 2);
  });
});

describe('drag', () => {
  it('stays under the pointer and ignores the playhead', () => {
    const dragging: Marble = { ...createMarble(0.2), mode: 'drag' };
    const next = run(dragging, 0.4, { target: 0.9, pointer: 0.35, reducedMotion: false });

    expect(next.mode).toBe('drag');
    expect(next.x).toBeCloseTo(0.35, 3);
  });
});

describe('glide', () => {
  it('rolls on with momentum after a flick and comes to rest', () => {
    const flicked = release(createMarble(0.3), 1.2, false);
    const early = run(flicked, 0.1, follow(0));
    const rest = run(flicked, 6, follow(early.x));

    expect(flicked.mode).toBe('glide');
    expect(early.x).toBeGreaterThan(0.3);
    expect(early.mode).toBe('glide');
    expect(rest.mode).toBe('follow');
    expect(Math.abs(rest.v)).toBeLessThan(1e-6);
  });

  it('travels the distance friction allows', () => {
    const state = glide(0.1, 1, 10, rail);

    expect(state.x).toBeCloseTo(0.1 + glideDistance(1, rail.friction), 3);
  });

  it('bounces softly off the bell end and never leaves the rail', () => {
    let marble: Marble = release(createMarble(0.9), FLICK_MAX_SPEED, false);
    let bounced = false;

    for (let i = 0; i < 600; i++) {
      marble = stepMarble(marble, 1 / 60, follow(1), rail);
      expect(marble.x).toBeGreaterThanOrEqual(0);
      expect(marble.x).toBeLessThanOrEqual(1);
      if (marble.v < 0) bounced = true;
    }

    expect(bounced).toBe(true);
  });

  it('loses speed at the end stop', () => {
    const before = 2;
    const after = glide(0.99, before, 1 / 60, rail);

    expect(after.v).toBeLessThan(0);
    expect(Math.abs(after.v)).toBeLessThan(before * rail.restitution + 1e-9);
  });

  it('does not glide when reduced motion is on', () => {
    expect(release(createMarble(0.3), 3, true).mode).toBe('follow');
    expect(isFlick(3, true)).toBe(false);
  });

  it('treats a slow release as a placement', () => {
    expect(release(createMarble(0.3), 0.1, false).mode).toBe('follow');
  });
});

describe('flickVelocity', () => {
  it('measures the speed just before release', () => {
    const samples = [0, 0.02, 0.04, 0.06, 0.08].map((t) => ({ t: 1 + t, x: 0.2 + t * 1.5 }));

    expect(flickVelocity(samples, 1.09)).toBeCloseTo(1.5, 5);
  });

  it('ignores movement from before the pointer paused', () => {
    const samples = [
      { t: 1, x: 0.1 },
      { t: 1.05, x: 0.6 },
    ];

    expect(flickVelocity(samples, 1.4)).toBe(0);
  });

  it('caps a wild flick', () => {
    const samples = [
      { t: 1, x: 0 },
      { t: 1.02, x: 1 },
    ];

    expect(flickVelocity(samples, 1.02)).toBe(FLICK_MAX_SPEED);
  });

  it('needs two samples', () => {
    expect(flickVelocity([{ t: 1, x: 0.5 }], 1)).toBe(0);
    expect(flickVelocity([], 1)).toBe(0);
  });
});

describe('rockOffset', () => {
  it('never passes the pin and dies away', () => {
    for (let t = 0; t <= 1.5; t += 0.01) expect(rockOffset(t, 6)).toBeLessThanOrEqual(0);

    expect(Math.abs(rockOffset(0.06, 6))).toBeGreaterThan(1);
    expect(Math.abs(rockOffset(0.9, 6))).toBeLessThan(0.1);
    expect(rockOffset(2, 6)).toBe(0);
    expect(rockOffset(0, 6)).toBe(0);
  });
});

describe('playheadNow', () => {
  it('carries the playhead forward between reports while playing', () => {
    expect(playheadNow(10, 0.2, 1, true, 100)).toBeCloseTo(0.102, 6);
    expect(playheadNow(10, 0.2, 2, true, 100)).toBeCloseTo(0.104, 6);
  });

  it('holds still when paused', () => {
    expect(playheadNow(10, 5, 1, false, 100)).toBe(0.1);
  });

  it('never runs more than half a second ahead of a stale report', () => {
    expect(playheadNow(10, 30, 1, true, 100)).toBeCloseTo(0.105, 6);
  });

  it('copes with an unknown or endless duration', () => {
    expect(playheadNow(10, 0, 1, true, 0)).toBe(0);
    expect(playheadNow(10, 0, 1, true, Number.NaN)).toBe(0);
    expect(playheadNow(10, 0, 1, true, Number.POSITIVE_INFINITY)).toBe(0);
    expect(playheadNow(500, 0, 1, true, 100)).toBe(1);
  });
});
