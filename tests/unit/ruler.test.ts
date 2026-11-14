import { describe, expect, it } from 'vitest';

import { formatClock, rulerTicks, TIER_MIN_WIDTH, tierFor } from '../../src/rail/ruler';

describe('tierFor', () => {
  it('matches the six size tiers in the spec', () => {
    expect(tierFor(1280)).toBe('xl');
    expect(tierFor(960)).toBe('xl');
    expect(tierFor(959)).toBe('l');
    expect(tierFor(640)).toBe('l');
    expect(tierFor(639)).toBe('m');
    expect(tierFor(420)).toBe('m');
    expect(tierFor(419)).toBe('s');
    expect(tierFor(280)).toBe('s');
    expect(tierFor(279)).toBe('xs');
    expect(tierFor(200)).toBe('xs');
    expect(tierFor(199)).toBe('xxs');
    expect(tierFor(0)).toBe('xxs');
  });

  it('keeps its thresholds in one place', () => {
    expect(Object.values(TIER_MIN_WIDTH)).toEqual([960, 640, 420, 280, 200, 0]);
  });
});

describe('formatClock', () => {
  it('formats minutes, seconds and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7)).toBe('0:07');
    expect(formatClock(754.9)).toBe('12:34');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(59, true)).toBe('0:00:59');
  });

  it('copes with bad input', () => {
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-4)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('rulerTicks', () => {
  const gaps = (duration: number, length: number, maxRank: number) => {
    const ticks = rulerTicks(duration, length).filter((tick) => tick.rank <= maxRank);
    return ticks.slice(1).map((tick, index) => (tick.frac - ticks[index]!.frac) * length);
  };

  it('numbers whole minutes, with half and fine marks between', () => {
    const ticks = rulerTicks(134, 800);
    const numbered = ticks.filter((tick) => tick.rank === 0);

    expect(numbered.map((tick) => tick.label)).toEqual(['0', '1', '2']);
    expect(numbered.map((tick) => tick.at)).toEqual([0, 60, 120]);
    expect(ticks.filter((tick) => tick.rank === 1).map((tick) => tick.at)).toEqual([30, 90]);
    expect(ticks.filter((tick) => tick.rank === 2).length).toBeGreaterThan(10);
    expect(ticks.every((tick) => tick.frac >= 0 && tick.frac <= 1)).toBe(true);
    expect(ticks.every((tick) => (tick.label === undefined) === (tick.rank !== 0))).toBe(true);
  });

  it('keeps numerals and fine marks apart at every film length and rail size', () => {
    for (const duration of [8, 24, 59, 72, 134, 600, 3600, 3 * 3600, 11 * 3600]) {
      for (const length of [90, 180, 320, 560, 900, 1800]) {
        expect(Math.min(...gaps(duration, length, 0), Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(56 - 1e-6);
        expect(Math.min(...gaps(duration, length, 2), Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(5 - 1e-6);
        expect(rulerTicks(duration, length).length).toBeLessThan(500);
      }
    }
  });

  it('uses the clock for clips under a minute and films over an hour', () => {
    expect(rulerTicks(24, 900).find((tick) => tick.rank === 0 && tick.at > 0)?.label).toBe('0:05');
    expect(rulerTicks(2 * 3600, 900).find((tick) => tick.rank === 0 && tick.at > 0)?.label).toBe('0:15:00');
  });

  it('draws nothing until the duration is known', () => {
    expect(rulerTicks(0, 800)).toEqual([]);
    expect(rulerTicks(Number.NaN, 800)).toEqual([]);
    expect(rulerTicks(Number.POSITIVE_INFINITY, 800)).toEqual([]);
    expect(rulerTicks(120, 0)).toEqual([]);
  });
});
