/**
 * Reads the dock: where every control is, and what state it is in. The DOM is the truth for both.
 * Rectangles are taken from layout offsets, not from client rectangles, so a key that is being
 * pressed, a flipper that is turned or a rail that is tilted is measured where it rests.
 */
import type { MarbleMode } from '../rail/physics';
import { type Tier, tierFor } from '../rail/ruler';

import type { Bands, Box, RailBox } from './layout';

export const CONTROLS = {
  lever: '#rl-play',
  back: '#rl-back',
  fwd: '#rl-fwd',
  counter: '.rl-counter',
  horn: '#rl-mute',
  shutters: '.rl-shutters',
  jack: '#rl-rate',
  tapekey: '#rl-cc',
  locket: '#rl-pip',
  cast: '#rl-cast',
  airplay: '#rl-airplay',
  drawer: '#rl-settings',
  cord: '#rl-fs',
  duration: '.rl-duration',
  nameplate: '.rl-nameplate',
  slot: '.rl-tape',
  lift: '.rl-lift',
  bell: '.rl-bell',
} as const;

export type ControlName = keyof typeof CONTROLS;

export interface Layout {
  readonly bands: Bands;
  /** Height of the picture above the dock. */
  readonly filmRows: number;
  readonly tier: Tier;
  readonly rtl: boolean;
  readonly rail: RailBox | null;
  /** Where each chapter starts along the rail (0 to 1), and how long its chime bar is. */
  readonly chapters: readonly { readonly at: number; readonly length: number }[];
  readonly boxes: { readonly [name in ControlName]: Box | null };
  /** Width of one character cell of the drum counter. */
  readonly counterAdvance: number;
  /** One layout unit (`--media-spacing`) in pixels. */
  readonly unit: number;
}

export interface MachineState {
  paused: boolean;
  ended: boolean;
  started: boolean;
  waiting: boolean;
  /** The marble on the rail: position 0 to 1, radians rolled, and whether a hand has it. */
  marble: { x: number; turn: number; mode: MarbleMode };
  /** Pixels the marble is rocked back from its place. */
  rock: number;
  /** Degrees the speed jack has tilted the rail. */
  tilt: number;
  /** Share of the film that has loaded. */
  buffered: number;
  volume: number;
  muted: boolean;
  /** Step of the speed jack, 0 to 5. */
  rate: number;
  captions: boolean;
  pip: boolean;
  cast: boolean;
  airplay: boolean;
  drawer: boolean;
  fullscreen: boolean;
  /** What the drum counter shows. */
  counter: string;
  /** Index of the chapter the film is in, or -1. */
  chapter: number;
}

/** A positioned ancestor chain up to the dock, as a box. Null when the element takes up no room or cannot be seen. */
function boxOf(element: HTMLElement | null, dock: HTMLElement): Box | null {
  if (!element || !element.offsetParent || element.offsetWidth === 0 || element.offsetHeight === 0) return null;
  if (getComputedStyle(element).visibility === 'hidden') return null;

  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;

  while (node && node !== dock) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }

  if (node !== dock) {
    const own = element.getBoundingClientRect();
    const base = dock.getBoundingClientRect();
    x = own.left - base.left;
    y = own.top - base.top;
  }

  return { x: x + element.offsetWidth / 2, y: y + element.offsetHeight / 2, w: element.offsetWidth, h: element.offsetHeight };
}

let ruler: CanvasRenderingContext2D | null | undefined;

/** Width of one character of the counter, letter spacing included. */
function advanceOf(counter: HTMLElement | null): number {
  if (!counter) return 0;
  const style = getComputedStyle(counter);
  const spacing = Number.parseFloat(style.letterSpacing) || 0;

  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return Number.parseFloat(style.fontSize) * 0.6 + spacing;
  ruler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return ruler.measureText('0').width + spacing;
}

export function measure(container: HTMLElement, dock: HTMLElement): Layout {
  const find = (selector: string) => dock.querySelector<HTMLElement>(selector);
  const rtl = getComputedStyle(dock).direction === 'rtl';
  const lip = find('.rl-lip');
  const bench = find('.rl-bench');
  const bands: Bands = {
    width: dock.offsetWidth,
    height: dock.offsetHeight,
    lip: lip?.offsetHeight ?? 0,
    bench: bench ? (boxOf(bench, dock)?.y ?? 0) - bench.offsetHeight / 2 : dock.offsetHeight,
  };

  const boxes = Object.fromEntries(
    (Object.keys(CONTROLS) as ControlName[]).map((name) => [name, boxOf(find(CONTROLS[name]), dock)])
  ) as { [name in ControlName]: Box | null };

  const tier = tierFor(container.clientWidth);
  const track = find('.rl-chapters');
  const short = tier === 'm' || tier === 's' ? 0.55 : 1;
  const chapters =
    track && track.offsetWidth > 0
      ? [...track.querySelectorAll<HTMLElement>('.rl-chapter')].map((chapter) => {
          const from = rtl ? track.offsetWidth - chapter.offsetLeft - chapter.offsetWidth : chapter.offsetLeft;
          const bar = chapter.querySelector<HTMLElement>('.rl-chime');
          return { at: from / track.offsetWidth, length: (bar?.offsetHeight ?? 12) * short };
        })
      : [];
  const slider = boxOf(find('.rl-slider'), dock);
  const beam = find('.rl-beam');
  const thumb = find('.rl-marble');
  let rail: RailBox | null = null;

  if (slider && beam && thumb && thumb.offsetWidth > 0) {
    const left = slider.x - slider.w / 2;
    const top = slider.y - slider.h / 2;

    rail = {
      start: rtl ? left + slider.w : left,
      end: rtl ? left : left + slider.w,
      pivot: top + beam.offsetTop,
      marble: top + thumb.offsetTop + thumb.offsetHeight / 2,
      radius: thumb.offsetWidth / 2,
      beam: beam.offsetHeight,
      over: Math.max(0, -beam.offsetLeft),
      // Room is kept for a full-length bar whether or not the film has chapters.
      chime: Math.max(thumb.offsetWidth * 0.55 * short, ...chapters.map((chapter) => chapter.length)),
    };
  }

  return {
    bands,
    filmRows: dock.offsetTop,
    tier,
    rtl,
    rail,
    chapters,
    boxes,
    counterAdvance: advanceOf(find(CONTROLS.counter)),
    unit: Number.parseFloat(getComputedStyle(dock).getPropertyValue('--media-spacing')) || 4,
  };
}

const RATES = ['0.5', '0.75', '1', '1.25', '1.5', '2'];

const percent = (element: HTMLElement | null, property: string): number =>
  (Number.parseFloat(element?.style.getPropertyValue(property) ?? '') || 0) / 100;

interface RailElement extends HTMLElement {
  readonly marble: { x: number; turn: number; mode: MarbleMode };
}

/** The player's state as the controls themselves report it. */
export function readState(dock: HTMLElement, previous?: MachineState): MachineState {
  const find = (selector: string) => dock.querySelector<HTMLElement>(selector);
  const rail = find('rolling-rail') as RailElement | null;
  const lever = find(CONTROLS.lever);
  const horn = find(CONTROLS.horn);
  const slider = find('.rl-slider');
  const rate = RATES.indexOf(find(CONTROLS.jack)?.dataset.rate ?? '1');
  const marble = rail?.marble;

  return {
    paused: lever?.hasAttribute('data-paused') ?? true,
    ended: lever?.hasAttribute('data-ended') ?? false,
    started: rail?.hasAttribute('data-started') ?? false,
    waiting: rail?.hasAttribute('data-waiting') ?? false,
    marble: marble ? { x: marble.x, turn: marble.turn, mode: marble.mode } : (previous?.marble ?? { x: 0, turn: 0, mode: 'follow' }),
    rock: Number.parseFloat(rail?.style.getPropertyValue('--rl-rock') ?? '') || 0,
    tilt: Number.parseFloat(rail?.style.getPropertyValue('--rl-tilt') ?? '') || 0.4,
    buffered: percent(slider, '--media-slider-buffer'),
    volume: percent(find(CONTROLS.shutters), '--media-slider-fill'),
    muted: horn ? horn.hasAttribute('data-muted') || horn.dataset.volumeLevel === 'off' : false,
    rate: rate === -1 ? 2 : rate,
    captions: find(CONTROLS.tapekey)?.hasAttribute('data-active') ?? false,
    pip: find(CONTROLS.locket)?.hasAttribute('data-pip') ?? false,
    cast: find(CONTROLS.cast)?.dataset.castState === 'connected',
    airplay: find(CONTROLS.airplay)?.dataset.airplayState === 'connected',
    drawer: find(CONTROLS.drawer)?.getAttribute('aria-expanded') === 'true',
    fullscreen: find(CONTROLS.cord)?.hasAttribute('data-fullscreen') ?? false,
    counter: find(CONTROLS.counter)?.textContent?.trim() ?? '',
    chapter: [...dock.querySelectorAll('.rl-chapter')].findIndex((chapter) => chapter.hasAttribute('data-active')),
  };
}
