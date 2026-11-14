/** Layout helpers for the rail: size tiers, the burned-in ruler, clock text. Pure functions. */

export type Tier = 'xl' | 'l' | 'm' | 's' | 'xs' | 'xxs';

/** Lower bound of each tier, in CSS pixels of player width. Mirrors the container queries in rolling.css. */
export const TIER_MIN_WIDTH: Readonly<Record<Tier, number>> = { xl: 960, l: 640, m: 420, s: 280, xs: 200, xxs: 0 };

const TIER_ORDER: readonly Tier[] = ['xl', 'l', 'm', 's', 'xs', 'xxs'];

export function tierFor(width: number): Tier {
  return TIER_ORDER.find((tier) => width >= TIER_MIN_WIDTH[tier]) ?? 'xxs';
}

/** `0:07`, `12:34`, `1:02:03`. Hours appear when the value or the film needs them. */
export function formatClock(seconds: number, withHours = false): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');

  return hours > 0 || withHours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

export interface Tick {
  /** Seconds from the start. */
  readonly at: number;
  /** Position along the rail, 0 to 1. */
  readonly frac: number;
  /** 0 = numbered, 1 = half mark, 2 = fine mark. A ruler reads by its three tick lengths. */
  readonly rank: 0 | 1 | 2;
  /** Numbered ticks carry a numeral. */
  readonly label?: string;
}

/** Numbered steps in seconds, each with the finer steps that divide it the way a ruler would. */
const RULER_STEPS: readonly (readonly [major: number, minors: readonly number[]])[] = [
  [5, [1]],
  [10, [1, 2, 5]],
  [15, [5]],
  [30, [5, 10, 15]],
  [60, [5, 10, 15, 30]],
  [120, [10, 30, 60]],
  [300, [30, 60]],
  [600, [60, 120, 300]],
  [900, [60, 300]],
  [1800, [300, 600, 900]],
  [3600, [300, 600, 900, 1800]],
  [7200, [900, 1800, 3600]],
  [14400, [1800, 3600, 7200]],
];

const MIN_FINE_GAP = 5;
/** Films at least this long are numbered in minutes, as the spec's "minutes burned into the beam". */
const MINUTE_RULER_FROM = 60;

const isMultiple = (value: number, step: number): boolean => Math.abs(value / step - Math.round(value / step)) < 1e-6;

/**
 * Ticks for a film of `duration` seconds on a rail `length` pixels long.
 * Numerals never sit closer than `minLabelGap` pixels, whatever the film length or player size.
 */
export function rulerTicks(duration: number, length: number, minLabelGap = 56): Tick[] {
  if (!(duration > 0) || !Number.isFinite(duration) || !(length > 0)) return [];

  const hours = duration >= 3600;
  const pxPerSecond = length / duration;
  // `1:30:00` is wider than `12`, so hour-long films get more room per numeral.
  const gap = hours ? minLabelGap * 1.4 : minLabelGap;
  const steps = RULER_STEPS.filter(([step]) => duration < MINUTE_RULER_FROM || step >= 60);
  const [tableMajor, minors] = steps.find(([step]) => step * pxPerSecond >= gap) ?? steps[steps.length - 1]!;
  let major = tableMajor;
  // A film longer than the table on a very short rail: keep doubling until the numerals have room.
  while (major * pxPerSecond < gap) major *= 2;
  const fine = minors.find((step) => step * pxPerSecond >= MIN_FINE_GAP) ?? major;
  const half = isMultiple(major / 2, fine) ? major / 2 : major;
  const ticks: Tick[] = [];

  for (let index = 0; index * fine <= duration + 1e-6; index++) {
    const at = index * fine;
    const rank = isMultiple(at, major) ? 0 : isMultiple(at, half) ? 1 : 2;

    ticks.push({
      at,
      frac: at / duration,
      rank,
      // Whole minutes read as a ruler's numerals; short clips and long films need the clock.
      ...(rank === 0 ? { label: major >= 60 && !hours ? String(Math.round(at / 60)) : formatClock(at, hours) } : {}),
    });
  }

  return ticks;
}
