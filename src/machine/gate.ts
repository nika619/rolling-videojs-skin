/**
 * When the 3D machine may run, at what quality, and how often it may draw. Pure functions:
 * the element owns the observers and the clock, this file owns the decisions.
 */
import type { Tier } from '../rail/ruler';

export type Quality = 'high' | 'standard' | 'flat';
export type MachineMode = '3d' | 'flat';

export interface GateInput {
  /** WebGL 2 is there and has not failed on this page. */
  readonly webgl: boolean;
  /** The user asked for less data: the 3D chunk is never fetched. */
  readonly saveData: boolean;
  /** Forced colours: plain system-coloured controls, no canvas. */
  readonly forcedColors: boolean;
  readonly tier: Tier;
  /** The player has been on screen at least once. */
  readonly seen: boolean;
  readonly quality: Quality;
}

/** The two smallest tiers are the flat skin only: there is no room for a machine. */
const FLAT_TIERS: ReadonlySet<Tier> = new Set(['xs', 'xxs']);

export function machineMode(input: GateInput): MachineMode {
  const { webgl, saveData, forcedColors, tier, seen, quality } = input;
  return webgl && seen && !saveData && !forcedColors && quality !== 'flat' && !FLAT_TIERS.has(tier) ? '3d' : 'flat';
}

export interface Device {
  /** `navigator.hardwareConcurrency`. */
  readonly cores: number;
  /** `navigator.deviceMemory` in GB, where the browser tells. */
  readonly memory: number | undefined;
  /** The WebGL renderer string, where the browser tells. */
  readonly renderer: string;
}

/** Where to start. A software rasteriser or a small machine begins one step down; the frame clock decides the rest. */
export function startQuality(device: Device): Quality {
  if (/swiftshader|llvmpipe|software|basic render/i.test(device.renderer)) return 'standard';
  if (device.cores < 6 || (device.memory !== undefined && device.memory < 4)) return 'standard';
  return 'high';
}

/** Longest drawing-buffer side, as a multiple of CSS pixels. */
export const PIXEL_RATIO_CAP: Readonly<Record<Quality, number>> = { high: 2, standard: 1.25, flat: 1 };

/** A frame slower than this (ms) while the machine is free-running counts against the tier. */
export const SLOW_FRAME_MS = 24;
/** How many free-running frames are judged at a time. */
export const FRAME_WINDOW = 40;

/**
 * Drop one tier when most of a window of free-running frames ran slow. Never climbs back:
 * a machine that was slow once would only flicker between tiers.
 */
export function nextQuality(quality: Quality, frameMs: readonly number[]): Quality {
  if (quality === 'flat' || frameMs.length < FRAME_WINDOW) return quality;
  const slow = frameMs.filter((ms) => ms > SLOW_FRAME_MS).length;
  if (slow <= frameMs.length * 0.6) return quality;
  return quality === 'high' ? 'standard' : 'flat';
}

export type Activity = 'interacting' | 'playing' | 'settled';

/** Plain playback needs no more than 30 frames a second. */
export const PLAYBACK_FRAME_MS = 31;

/** The shortest gap between two frames, in ms. Settled draws nothing at all. */
export function frameGap(activity: Activity): number {
  if (activity === 'interacting') return 0;
  return activity === 'playing' ? PLAYBACK_FRAME_MS : Number.POSITIVE_INFINITY;
}
