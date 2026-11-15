import { describe, expect, it } from 'vitest';

import { FRAME_WINDOW, frameGap, machineMode, nextQuality, startQuality } from '../../src/machine/gate';
import {
  type Bands,
  counterCells,
  depthAt,
  drumTurn,
  heightAt,
  onPanel,
  panelToWorld,
  project,
  type RailBox,
  railShape,
  sinkRows,
  stage,
  worldTilt,
} from '../../src/machine/layout';
import { LAMP, luminance, sameLight, smoothLight, withLamp, zoneMeans } from '../../src/machine/light';
import { spring, stepSpring } from '../../src/machine/spring';

const open = { webgl: true, saveData: false, forcedColors: false, tier: 'xl', seen: true, quality: 'high' } as const;

describe('when the 3D machine runs', () => {
  it('runs on a capable player that has been on screen', () => {
    expect(machineMode(open)).toBe('3d');
    expect(machineMode({ ...open, tier: 's', quality: 'standard' })).toBe('3d');
  });

  it('stays flat without WebGL, off screen, on reduced data, in forced colours and at the two smallest tiers', () => {
    expect(machineMode({ ...open, webgl: false })).toBe('flat');
    expect(machineMode({ ...open, seen: false })).toBe('flat');
    expect(machineMode({ ...open, saveData: true })).toBe('flat');
    expect(machineMode({ ...open, forcedColors: true })).toBe('flat');
    expect(machineMode({ ...open, tier: 'xs' })).toBe('flat');
    expect(machineMode({ ...open, tier: 'xxs' })).toBe('flat');
    expect(machineMode({ ...open, quality: 'flat' })).toBe('flat');
  });

  it('starts a software renderer or a small machine one tier down', () => {
    expect(startQuality({ cores: 12, memory: 16, renderer: 'ANGLE (NVIDIA GeForce RTX 4050)' })).toBe('high');
    expect(startQuality({ cores: 12, memory: 16, renderer: 'ANGLE (Google, Vulkan SwiftShader)' })).toBe('standard');
    expect(startQuality({ cores: 4, memory: undefined, renderer: 'Adreno 640' })).toBe('standard');
    expect(startQuality({ cores: 8, memory: 2, renderer: 'Mali-G72' })).toBe('standard');
  });

  it('drops one tier when most frames run slow, and never climbs back', () => {
    const fast = Array.from({ length: FRAME_WINDOW }, () => 16.7);
    const slow = Array.from({ length: FRAME_WINDOW }, () => 40);
    const mixed = fast.map((ms, index) => (index % 2 ? 40 : ms));

    expect(nextQuality('high', fast)).toBe('high');
    expect(nextQuality('high', mixed)).toBe('high');
    expect(nextQuality('high', slow)).toBe('standard');
    expect(nextQuality('standard', slow)).toBe('flat');
    expect(nextQuality('flat', fast)).toBe('flat');
    expect(nextQuality('high', slow.slice(0, 10))).toBe('high');
  });

  it('draws every frame while interacting, 30 a second in plain playback and none when settled', () => {
    expect(frameGap('interacting')).toBe(0);
    expect(frameGap('playing')).toBeGreaterThan(1000 / 60);
    expect(frameGap('playing')).toBeLessThanOrEqual(1000 / 30);
    expect(frameGap('settled')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('placement from the DOM', () => {
  const bands: Bands = { width: 1100, height: 182, lip: 28, bench: 110 };
  const s = stage(bands, 619);

  it('puts a point back on the screen row it was asked for', () => {
    expect(project({ x: 40, y: 12, z: depthAt(90, 12, 182) }, 182)).toEqual({ x: 40, y: expect.closeTo(90, 6) });
    expect(heightAt(90, depthAt(90, 12, 182), 182)).toBeCloseTo(12, 6);
  });

  it('shows a point on the deck exactly under its control, however far it stands off the face', () => {
    for (const lift of [0, 8, 20]) {
      const shown = project(panelToWorld(s.deck, onPanel(s.deck, 300, 146, lift)), bands.height);
      expect(shown.x).toBe(300);
      expect(shown.y).toBeCloseTo(146, 6);
    }
  });

  it('moves a key down the screen as it sinks: six pixels of travel are the two the flat skin moves', () => {
    expect(sinkRows(6)).toBeCloseTo(2, 0);
  });

  it('stands the deck on the bottom edge, the lip under the film, and the floor between them', () => {
    expect(project(panelToWorld(s.deck, { x: 0, y: 0, z: 0 }), 182).y).toBeCloseTo(182, 6);
    expect(project(panelToWorld(s.lip, { x: 0, y: s.lip.length, z: 0 }), 182).y).toBeCloseTo(0, 6);
    expect(s.floor).toBeGreaterThan(0);
    expect(s.floor).toBeLessThan(s.ridge.y);
    expect(s.film.z).toBeLessThan(s.lip.z);
    expect(s.film.height).toBeGreaterThan(619);
  });

  const box: RailBox = { start: 49, end: 999, pivot: 72, marble: 55, radius: 13, beam: 20, over: 20, chime: 14.4 };
  const rail = railShape(box, s, bands.height);

  it('rests the marble on two rods, where the DOM puts the slider thumb', () => {
    expect(project({ x: 0, y: rail.marbleY, z: rail.z }, 182).y).toBeCloseTo(box.marble, 6);
    // Touching both rods: centre to centre is the two radii.
    expect(Math.hypot(rail.rodGap / 2, rail.marbleY - rail.rodY)).toBeCloseTo(box.radius + rail.rodRadius, 6);
    expect(rail.beamTop).toBeLessThan(rail.rodY - rail.rodRadius);
  });

  it('tucks the snake under the beam, hangs the chime bars in front of it, and keeps both behind the ridge at every tier', () => {
    for (const [b, r] of [
      [bands, box],
      [{ width: 520, height: 124, lip: 8, bench: 64 }, { start: 30, end: 490, pivot: 39, marble: 26, radius: 9, beam: 16, over: 14, chime: 7.9 }],
      [{ width: 360, height: 116, lip: 8, bench: 60 }, { start: 26, end: 334, pivot: 37, marble: 24, radius: 9, beam: 16, over: 10, chime: 7.9 }],
    ] as const) {
      const st = stage(b, (b.width * 9) / 16);
      const shape = railShape(r, st, b.height);
      const snakeRow = project({ x: 0, y: shape.snakeY, z: shape.snakeZ }, b.height).y;

      expect(shape.snakeZ + shape.snakeRadius).toBeLessThan(shape.chimeZ - shape.chimeRadius);
      expect(shape.chimeZ + shape.chimeRadius).toBeLessThan(st.ridge.z);
      expect(shape.snakeY - shape.snakeRadius).toBeGreaterThan(st.floor);
      expect(shape.faceRow).toBeGreaterThan(r.marble);
      // The snake shows whole between the beam and the ridge, and no bar is longer than the room it has.
      expect(snakeRow - shape.snakeRadius).toBeGreaterThanOrEqual(shape.faceRow + r.beam - 1);
      expect(snakeRow + shape.snakeRadius).toBeLessThan(st.ridgeRow);
      expect(shape.snakeRadius).toBeGreaterThanOrEqual(3);
      expect(shape.chimeRows).toBeGreaterThan(3);
      expect(shape.chimeRows).toBeLessThanOrEqual(r.chime);
    }
  });

  it('tilts the rail in the world so that the screen shows the DOM slope', () => {
    const world = worldTilt(0.8);
    // A point 900px along the rail rises this far on screen, in both.
    expect(Math.sin(world) * 900 * Math.cos(Math.PI / 6)).toBeCloseTo(Math.tan((0.8 * Math.PI) / 180) * 900 * Math.cos(world), 3);
    expect(worldTilt(0)).toBe(0);
  });

  it('gives the drum counter one drum per character, centred, a tenth of a turn per digit', () => {
    expect(counterCells(' 0:09 ', 100, 10)).toEqual([
      { char: '0', x: 85 },
      { char: ':', x: 95 },
      { char: '0', x: 105 },
      { char: '9', x: 115 },
    ]);
    expect(drumTurn('0')).toBe(0);
    expect(drumTurn('5')).toBeCloseTo(Math.PI, 9);
    expect(drumTurn(':')).toBe(0);
    expect(drumTurn('-')).toBe(0);
  });
});

describe('film light', () => {
  const frame = (colours: [number, number, number][]): number[] =>
    Array.from({ length: 2 }, () => colours.flatMap((colour) => [...colour, 255])).flat();

  it('reads the left, the centre and the right of the frame', () => {
    const light = zoneMeans(frame([[255, 0, 0], [255, 0, 0], [0, 255, 0], [0, 255, 0], [0, 0, 255], [0, 0, 255]]), 6, 2);
    expect(light.left).toEqual([1, 0, 0]);
    expect(light.centre).toEqual([0, 1, 0]);
    expect(light.right).toEqual([0, 0, 1]);
  });

  it('eases toward a new frame and gets there', () => {
    const red = { left: [1, 0, 0], centre: [1, 0, 0], right: [1, 0, 0] } as const;
    const step = smoothLight(LAMP, red, 0.1);
    expect(step.centre[1]).toBeLessThan(LAMP.centre[1]);
    expect(step.centre[1]).toBeGreaterThan(0);
    expect(smoothLight(LAMP, red, 0)).toEqual(LAMP);
    expect(sameLight(smoothLight(LAMP, red, 30), red)).toBe(true);
  });

  it('never leaves the bench in the dark: a black frame becomes the warm lamp, a bright frame is left alone', () => {
    const black = { left: [0, 0, 0], centre: [0, 0, 0], right: [0, 0, 0] } as const;
    const lit = withLamp(black);
    expect(luminance(lit.centre)).toBeGreaterThan(0.15);
    expect(lit.centre[0]).toBeGreaterThan(lit.centre[2]);

    const bright = { left: [0.2, 0.5, 0.9], centre: [0.9, 0.9, 0.9], right: [0.1, 0.8, 0.2] } as const;
    expect(withLamp(bright)).toEqual(bright);
  });
});

describe('mechanism springs', () => {
  it('settle on the target without exploding on a long frame', () => {
    const s = spring(0);
    let moving = true;
    for (let i = 0; i < 400 && moving; i++) moving = stepSpring(s, 1, 40, 0.5, i === 3 ? 0.5 : 1 / 60);
    expect(moving).toBe(false);
    expect(s.x).toBe(1);
    expect(s.v).toBe(0);
  });

  it('swing past the target when they are loose, and not when they are critically damped', () => {
    const loose = spring(0);
    const firm = spring(0);
    let peak = 0;
    let firmPeak = 0;
    for (let i = 0; i < 240; i++) {
      stepSpring(loose, 1, 30, 0.25, 1 / 120);
      stepSpring(firm, 1, 30, 1, 1 / 120);
      peak = Math.max(peak, loose.x);
      firmPeak = Math.max(firmPeak, firm.x);
    }
    expect(peak).toBeGreaterThan(1.1);
    expect(firmPeak).toBeLessThanOrEqual(1.0001);
  });
});
