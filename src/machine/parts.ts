/**
 * Every part of the machine, built in code from the measured layout: boards, rail, marble, chimes, bell,
 * the snake and its ladder, and one mechanism per control. Each builder returns an updater that moves its
 * part from the player's state and says whether it is still moving.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Mesh,
  Object3D,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { alongSlope, type Box, counterCells, drumTurn, heightAt, LEAN, onPanel, type Panel, PITCH, railShape, type Stage, worldTilt } from './layout';
import type { Materials } from './materials';
import type { ControlName, Layout, MachineState } from './measure';
import { type Spring, snapSpring, spring, stepSpring } from './spring';

export interface Frame {
  readonly state: MachineState;
  readonly layout: Layout;
  readonly stage: Stage;
  /** Seconds since the last frame, and seconds on the clock. */
  readonly dt: number;
  readonly now: number;
  /** Reduced motion: mechanisms change state without travel. */
  readonly calm: boolean;
  /** The control a finger or a key is holding down, and the one a mouse is over. */
  readonly pressed: ControlName | null;
  readonly hovered: ControlName | null;
  readonly events: { kickBack: boolean; kickForward: boolean };
}

/** Moves a part for this frame. True while it is still moving. */
export type Updater = (frame: Frame) => boolean;
/** What survives a rebuild: springs and counters, so a resize never restarts a motion. */
export type Memory = Map<string, unknown>;

export interface Build {
  readonly materials: Materials;
  readonly layout: Layout;
  readonly stage: Stage;
  readonly world: Group;
  readonly memory: Memory;
}

/** How far a key's face stands off the deck, and how far it sinks: six pixels of travel show as two on screen. */
const KEY = 8;
const TRAVEL = 6;
const TAU = Math.PI * 2;
const OFF = LEAN - PITCH;
const COS_P = Math.cos(PITCH);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const ease = (t: number): number => t * t * (3 - 2 * t);
const move = (s: Spring, target: number, omega: number, zeta: number, frame: Frame): boolean =>
  frame.calm ? snapSpring(s, target) : stepSpring(s, target, omega, zeta, frame.dt);

function roundRect(w: number, h: number, radius: number, into: Shape | Path = new Shape()): Shape | Path {
  const r = Math.max(0.01, Math.min(radius, w / 2, h / 2));
  const x = -w / 2;
  const y = -h / 2;

  into.moveTo(x + r, y);
  into.lineTo(x + w - r, y);
  into.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  into.lineTo(x + w, y + h - r);
  into.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  into.lineTo(x + r, y + h);
  into.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  into.lineTo(x, y + r);
  into.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return into;
}

/** A plate cut to an outline: its back at z = 0, its face at z = depth, every edge eased. */
function slab(outline: Shape, depth: number, bevel = 1.1): ExtrudeGeometry {
  const b = Math.min(bevel, depth / 2 - 0.01);
  const geometry = new ExtrudeGeometry(outline, {
    depth: depth - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments: 14,
  });
  geometry.translate(0, 0, b);
  return geometry;
}

const plate = (w: number, h: number, depth: number, radius: number, bevel?: number): ExtrudeGeometry =>
  slab(roundRect(w, h, radius) as Shape, depth, bevel);

/** A frame around a window. */
function bezel(w: number, h: number, border: number, depth: number, radius: number): ExtrudeGeometry {
  const outline = roundRect(w + border * 2, h + border * 2, radius + border) as Shape;
  outline.holes.push(roundRect(w, h, radius, new Path()) as Path);
  return slab(outline, depth, 1.2);
}

/** A shape turned on a lathe about z: [radius, height] pairs from the centre outward. */
function turned(profile: readonly (readonly [number, number])[], segments = 40): LatheGeometry {
  const geometry = new LatheGeometry(
    profile.map(([radius, height]) => new Vector2(Math.max(radius, 0.0001), height)),
    segments
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function put<T extends Object3D>(parent: Object3D, child: T, x = 0, y = 0, z = 0): T {
  child.position.set(x, y, z);
  parent.add(child);
  return child;
}

function mesh(parent: Object3D, geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, shadow = true): Mesh {
  const made = new Mesh(geometry, material);
  made.castShadow = shadow;
  made.receiveShadow = true;
  return put(parent, made, x, y, z);
}

/** A rod along x. */
const rod = (radius: number, length: number, sides = 10): CylinderGeometry => {
  const geometry = new CylinderGeometry(radius, radius, length, sides);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
};

/** A post along z: out of a panel. */
const post = (top: number, foot: number, height: number, sides = 24): CylinderGeometry => {
  const geometry = new CylinderGeometry(top, foot, height, sides);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, height / 2);
  return geometry;
};

export function buildMachine(build: Build): Updater[] {
  const { materials: mats, layout, stage, world, memory } = build;
  const { width: W, height: H } = layout.bands;
  const { boxes, unit: u } = layout;
  const updaters: Updater[] = [];
  const mem = <T>(name: string, make: () => T): T => {
    if (!memory.has(name)) memory.set(name, make());
    return memory.get(name) as T;
  };

  /** A leaning board and the group whose coordinates are the board's own. */
  const board = (panel: Panel, kind: 'deck' | 'lip'): Group => {
    const group = put(world, new Group(), 0, panel.y, panel.z);
    group.rotation.x = -LEAN;
    mesh(group, new BoxGeometry(W + 8, panel.length + 6, 10), mats.wood(kind), W / 2, panel.length / 2 - 3, -5);
    // A rounded nosing along the top edge catches the film's light.
    mesh(group, rod(3.2, W + 8, 14), mats.wood(kind, 0.3), W / 2, panel.length - 0.4, -3.4);
    return group;
  };

  const deck = board(stage.deck, 'deck');
  const lip = board(stage.lip, 'lip');
  const depth = stage.ridge.z - stage.lip.z + 8;

  mesh(world, new BoxGeometry(W + 8, 8, depth), mats.wood('floor', 0.35), W / 2, stage.floor - 4, stage.lip.z + depth / 2 - 4);
  // A brass line let into the deck near its front edge.
  mesh(deck, new BoxGeometry(W - u * 6, 1.3, 0.5), mats.brass, W / 2, u * 1.6, 0.1, false);

  const face = (box: Box, lift = KEY): Vector3 => {
    const at = onPanel(stage.deck, box.x, box.y, lift);
    return new Vector3(at.x, at.y, 0);
  };
  /** Shift along the slope that keeps a face `rise` higher than its group on the same screen row. */
  const settle = (rise: number): number => -rise * Math.tan(OFF);

  /** A group at a control, whose z follows the press of that control. */
  const key = (name: ControlName, box: Box, latched: (state: MachineState) => boolean = () => false): Group => {
    const group = put(deck, new Group());
    const at = face(box);
    const sink = mem(`press-${name}`, () => spring(0));

    group.position.copy(at);
    updaters.push((frame) => {
      const busy = move(sink, frame.pressed === name || latched(frame.state) ? 1 : frame.hovered === name ? -0.3 : 0, 70, 0.8, frame);
      group.position.z = KEY - TRAVEL * sink.x;
      return busy;
    });
    return group;
  };

  // ---------- Tape lip ----------

  if (boxes.slot) {
    const at = onPanel(stage.lip, boxes.slot.x, boxes.slot.y, 0);
    mesh(lip, new BoxGeometry(boxes.slot.w, 2.4, 0.5), mats.dark, at.x, at.y, 0.1, false);
    for (const side of [-1, 1]) mesh(lip, new BoxGeometry(boxes.slot.w + 6, 1.4, 1.2), mats.brass, at.x, at.y + side * 2.2, 0.5, false);
  }
  if (boxes.nameplate) {
    const { x, y, w, h } = boxes.nameplate;
    const at = onPanel(stage.lip, x, y, 1.6);
    mesh(lip, plate(w, alongSlope(h), 1.6, 1.5, 0.5), mats.brass, at.x, at.y, 0);
    for (const side of [-1, 1]) mesh(lip, post(1.1, 1.1, 0.5, 10), mats.brassPolished, at.x + side * (w / 2 - u * 1.75), at.y, 1.6, false);
  }

  // ---------- Rail tier ----------

  const railBox = layout.rail;

  if (railBox) {
    const shape = railShape(railBox, stage, H);
    const r = railBox.radius;
    const length = Math.abs(railBox.end - railBox.start);
    const dir = layout.rtl ? -1 : 1;
    const y0 = heightAt(railBox.pivot, shape.z, H);
    const rail = put(world, new Group(), railBox.end, y0, shape.z);
    const top = shape.beamTop - y0;
    const foot = top - shape.beamHeight;
    const halfTop = shape.beamTopWidth / 2;
    const halfFoot = shape.beamFootWidth / 2;
    const span = length + railBox.over * 2;
    const ride = shape.marbleY - y0;
    const rodY = shape.rodY - y0;

    rail.scale.x = dir;

    // The beam: wider at the foot, so its face leans into the light. Cut as a cross-section and run along x.
    const chamfer = Math.min(1.6, r * 0.12);
    const section = new Shape();
    section.moveTo(-halfFoot, foot);
    section.lineTo(halfFoot, foot);
    section.lineTo(halfTop, top - chamfer);
    section.lineTo(halfTop - chamfer, top);
    section.lineTo(-halfTop + chamfer, top);
    section.lineTo(-halfTop, top - chamfer);
    section.closePath();
    const beam = new ExtrudeGeometry(section, { depth: span, bevelEnabled: false });
    beam.rotateY(Math.PI / 2);
    mesh(rail, beam, mats.wood('beam', 0.35), -length - railBox.over, 0, 0);

    for (const side of [-1, 1]) {
      mesh(rail, rod(shape.rodRadius, span), mats.steel, -length / 2, rodY, (side * shape.rodGap) / 2);
    }
    for (const x of [-length - railBox.over, railBox.over]) {
      mesh(rail, new BoxGeometry(2.2, shape.rodRadius * 2 + shape.sleeper + 2, shape.beamTopWidth), mats.brass, x, top + shape.sleeper / 2 + 0.5, 0);
    }

    // Sleepers flip into place under the rods as the film loads; unloaded track has none.
    const pitch = Math.max(9, r * 0.95);
    const count = Math.floor(length / pitch) + 1;
    const sleepers = new InstancedMesh(new BoxGeometry(Math.max(2.2, r * 0.24), shape.sleeper, shape.beamTopWidth - 1.6), mats.wood('dark', 0.3), count);
    const laid = mem('sleepers', () => ({ front: 0, at: new Float32Array(0) }));
    const dummy = new Object3D();
    let sleepersDrawn = false;

    if (laid.at.length !== count) laid.at = new Float32Array(count).fill(-1);
    sleepers.receiveShadow = true;
    rail.add(sleepers);
    updaters.push((frame) => {
      const { buffered } = frame.state;
      // The loading runs along the rail as a front, so sleepers drop in one after another.
      laid.front = frame.calm ? buffered : clamp(buffered, laid.front - frame.dt * 2, laid.front + frame.dt * 0.9);
      let changed = !sleepersDrawn;
      let busy = laid.front !== buffered;

      for (let i = 0; i < count; i++) {
        const target = i / Math.max(1, count - 1) <= laid.front + 0.0005 ? 1 : 0;
        const from = laid.at[i]!;
        const to = from < 0 || frame.calm ? target : clamp(target, from - frame.dt * 7, from + frame.dt * 7);
        if (to !== from) {
          laid.at[i] = to;
          changed = true;
          busy ||= to !== target;
        }
      }
      if (!changed) return busy;
      sleepersDrawn = true;
      for (let i = 0; i < count; i++) {
        const a = Math.max(0, laid.at[i]!);
        dummy.position.set(-length + (i * length) / Math.max(1, count - 1), top + shape.sleeper / 2 + (1 - a) * 5, 0);
        dummy.rotation.set((1 - a) * 1.6, 0, 0);
        dummy.scale.setScalar(Math.max(a, 0.0001));
        dummy.updateMatrix();
        sleepers.setMatrixAt(i, dummy.matrix);
      }
      sleepers.instanceMatrix.needsUpdate = true;
      return busy;
    });

    // The bell at the end of the rail: the marble drops into it when the film is over.
    const bowlRadius = r + 4.5;
    const bowlDepth = r * 1.35;
    const bell = put(rail, new Group(), r + 5.5, rodY - r * 0.45, 0);
    const bowl = new LatheGeometry(
      [
        [0.0001, -bowlDepth],
        [bowlRadius * 0.55, -bowlDepth * 0.93],
        [bowlRadius * 0.9, -bowlDepth * 0.55],
        [bowlRadius, 0],
        [bowlRadius + 1.3, 0.4],
        [bowlRadius + 1.1, -bowlDepth * 0.5],
        [bowlRadius * 0.62, -bowlDepth - 1.4],
        [0.0001, -bowlDepth - 1.8],
      ].map(([x, y]) => new Vector2(x, y)),
      36
    );
    const bowlMesh = mesh(bell, bowl, mats.brassHollow);
    bowlMesh.rotation.x = 0.42;
    mesh(rail, new BoxGeometry(r + 4, 2.2, 3), mats.brass, r * 0.5 + 2, foot + 3, halfFoot - 2);
    const ring = mem('bell', () => spring(0));

    // Snakes and ladders: the rail is the board, the die on the jack sets the pace, and this is the way home.
    // The snake lies under the beam as the return track, its head under the bell and its tail coiled round the
    // foot of the ladder. It watches the marble come: its head follows it down the rail, rises toward the bell as
    // the film nears its end, and waits there with its mouth open. Played again, it swallows the marble, carries
    // it down its body to the ladder, and the ladder lifts it to the start.
    const snakeR = shape.snakeRadius;
    // Bigger than the body, as a carved head is: it has to read as a face from across the room.
    const headR = Math.max(snakeR * 1.6, r * 0.8);
    const bellX = railBox.end + dir * (r + 5.5);
    const ladderX = railBox.start - dir * (r + 6.5);
    const ladderZ = shape.z + halfFoot * 0.4;
    const coil = 8.5;
    const neckX = bellX - dir * snakeR * 0.6;
    const runEnd = ladderX + dir * coil * 1.7;
    const waves = Math.max(2, Math.round(Math.abs(neckX - runEnd) / (snakeR * 26)));
    const points: Vector3[] = [];
    const runSamples = Math.max(10, Math.round(length / 18));
    for (let i = 0; i <= runSamples; i++) {
      const t = i / runSamples;
      // Down a gentle slope toward the ladder, as a return track runs, and onto the ladder's line at the end.
      const toLadder = ease(clamp((t - 0.85) / 0.15, 0, 1));
      points.push(
        new Vector3(
          neckX + (runEnd - neckX) * t,
          shape.snakeY + snakeR * 0.3 * (1 - t) + Math.sin(t * waves * TAU) * snakeR * 0.2,
          shape.snakeZ + Math.cos(t * waves * TAU + 1) * snakeR * 0.28 * (1 - toLadder) + (ladderZ + coil * 0.45 - shape.snakeZ) * toLadder
        )
      );
    }
    // Once and a bit round the ladder, the tail thinning as it goes.
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2.3 - Math.PI * 0.08;
      points.push(new Vector3(ladderX + dir * coil * Math.cos(a), shape.snakeY - (i / 16) * snakeR * 0.8, ladderZ + coil * Math.sin(a)));
    }
    const curve = new CatmullRomCurve3(points);
    const tailEnd = points[points.length - 1]!;
    mats.snakeShape.radius.value = snakeR;
    mats.snakeShape.length.value = curve.getLength();
    // It lies in the beam's shadow, but it is the way home: it keeps its colours.
    mesh(world, new TubeGeometry(curve, Math.max(40, Math.round(length / 3)), snakeR, 16, false), mats.snake).receiveShadow = false;

    // The head turns on a pivot at the end of the body: a carved skull painted like the body, one gold diamond for a
    // crest, amber eyes with slit pupils under heavy brows, a jaw that drops, a forked tongue. At rest it lies turned
    // back along its own coils, looking up the rail at the marble.
    const neckFoot = points[0]!.clone();
    const head = put(world, new Group(), neckFoot.x, neckFoot.y, neckFoot.z);
    head.scale.x = dir;
    const pose = put(head, new Group());
    mesh(pose, new SphereGeometry(headR, 32, 20), mats.snakeHead, headR * 0.85, 0, 0).scale.set(1.25, 0.62, 0.95);
    const crest = mesh(pose, new CylinderGeometry(0, headR * 0.34, headR * 0.14, 4), mats.brass, headR * 0.95, headR * 0.66, 0, false);
    crest.scale.set(1.7, 1, 1);
    crest.rotation.y = Math.PI / 4;
    const jaw = put(pose, new Group(), headR * 0.2, -headR * 0.1, 0);
    // The jaw in the belly's cream: it draws the line of the mouth, which is what makes the shape a head.
    mesh(jaw, new SphereGeometry(headR * 0.95, 28, 12, 0, TAU, Math.PI / 2, Math.PI / 2), mats.snakeBelly, headR * 0.75, 0, 0).scale.set(1.25, 0.46, 0.86);
    mesh(pose, new SphereGeometry(headR * 0.8, 18, 10), mats.mouth, headR * 0.9, -headR * 0.14, 0, false).scale.set(1.2, 0.2, 0.78);
    for (const side of [-1, 1]) {
      const eyeR = headR * 0.32;
      const out = new Vector3(0.3, 0.45, side * 0.85).normalize();
      const eye = put(pose, new Group(), headR * 1.1, headR * 0.38, side * headR * 0.72);
      mesh(eye, new SphereGeometry(eyeR, 20, 14), mats.iris, 0, 0, 0, false);
      mesh(eye, new SphereGeometry(eyeR * 0.5, 12, 10), mats.eye, out.x * eyeR * 0.75, out.y * eyeR * 0.75, out.z * eyeR * 0.75, false).scale.set(0.36, 1.2, 0.36);
      // A brow over each eye: what makes a carved snake look watchful rather than surprised.
      const brow = mesh(eye, new SphereGeometry(eyeR * 1.2, 16, 8, 0, TAU, 0, Math.PI * 0.4), mats.snakeHead, -eyeR * 0.15, eyeR * 0.2, side * eyeR * 0.1);
      brow.rotation.x = side * 0.35;
    }
    const fork = new Shape();
    fork.moveTo(0, -0.45);
    fork.lineTo(headR * 0.9, -0.45);
    fork.lineTo(headR * 1.4, -headR * 0.28);
    fork.lineTo(headR * 1.05, 0);
    fork.lineTo(headR * 1.4, headR * 0.28);
    fork.lineTo(headR * 0.9, 0.45);
    fork.lineTo(0, 0.45);
    const tongue = mesh(pose, new ShapeGeometry(fork), mats.tongue, headR * 1.75, -headR * 0.16, 0, false);
    tongue.rotation.x = -Math.PI / 2;
    tongue.scale.x = 0.0001;
    // The neck shows only while the head is raised: from the end of the body up to the pivot.
    const neck = mesh(world, new CylinderGeometry(snakeR * 0.92, snakeR, 1, 16, 1, true), mats.snakeHead);
    const mouthAt = put(pose, new Object3D(), headR * 1.6, -headR * 0.1, 0);
    const watch = mem('snake', () => ({ yaw: spring(-2.75), lift: spring(0), jaw: spring(0), tongue: spring(0) }));
    const replay = mem('replay', () => ({ t: -1 }));

    updaters.push((frame) => {
      const { marble, ended, played } = frame.state;
      const t = replay.t;
      // Nearing the end of the film the head comes up under the bell, turns to face out and opens its jaws.
      const near = ended ? 1 : clamp((played - 0.86) / 0.14, 0, 1);
      const swallowing = t >= 0 && t < 0.34;
      const watching = -2.85 + 0.25 * clamp(marble.x, 0, 1);
      let busy = move(watch.yaw, ended || swallowing ? -1.75 : watching + (-1.75 - watching) * near, 9, 0.8, frame);
      busy = move(watch.lift, near, 10, 0.75, frame) || busy;
      busy = move(watch.jaw, swallowing ? 1 : t >= 0.34 && t < 0.5 ? 0 : ended ? 0.8 : near * 0.3, swallowing ? 30 : 14, 0.7, frame) || busy;
      busy = move(watch.tongue, ended && t < 0 ? 1 : 0, 22, 0.6, frame) || busy;
      const rise = watch.lift.x * snakeR * 1.3;
      head.position.y = neckFoot.y + rise;
      pose.rotation.set(0, watch.yaw.x, watch.lift.x * 0.45);
      jaw.rotation.z = -watch.jaw.x * 0.55;
      tongue.scale.x = Math.max(0.0001, watch.tongue.x);
      tongue.visible = watch.tongue.x > 0.02;
      neck.visible = rise > 0.5;
      neck.position.set(neckFoot.x, neckFoot.y + rise / 2, neckFoot.z);
      neck.scale.y = Math.max(0.01, rise);
      return busy;
    });

    // The ladder at the start of the rail, and the tray that carries the marble up it.
    const ladderTop = y0 + ride + Math.sin(worldTilt(0.8)) * length + 4;
    const ladder = put(world, new Group(), ladderX, stage.floor, ladderZ);
    const ladderHeight = ladderTop - stage.floor;
    for (const side of [-1, 1]) mesh(ladder, new CylinderGeometry(1.05, 1.05, ladderHeight, 8), mats.brassPolished, side * 4.6, ladderHeight / 2, 0);
    const rungs = Math.floor(ladderHeight / 5.2);
    const rungMesh = new InstancedMesh(rod(0.75, 9.2, 6), mats.brassPolished, rungs);
    for (let i = 0; i < rungs; i++) {
      dummy.position.set(0, (i + 0.6) * 5.2, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      rungMesh.setMatrixAt(i, dummy.matrix);
    }
    rungMesh.castShadow = true;
    ladder.add(rungMesh);
    const tray = mesh(ladder, new BoxGeometry(12, 1.8, 9), mats.brass, 0, 0, 2.5);

    // The marble: the playhead.
    const ball = mesh(rail, new SphereGeometry(r, 48, 32), mats.marble);
    const pinHeight = r * 0.9;
    const pin = mesh(rail, new CylinderGeometry(1.3, 1.5, pinHeight, 10), mats.brassPolished);
    const motion = mem('marble', () => ({ tilt: spring(0.4), grab: spring(0), drop: spring(0), pin: spring(0), wasEnded: false, leftEnd: 0 }));
    const bowlRest = new Vector3(r + 5.5, rodY - r * 0.45 - bowlDepth + r * 0.95, 0);
    const scratch = new Vector3();

    updaters.push((frame) => {
      const { marble, ended, paused, rock, tilt } = frame.state;
      let busy = move(motion.tilt, tilt, 15, 0.55, frame);

      rail.rotation.z = -worldTilt(motion.tilt.x);
      rail.updateMatrixWorld();
      const startX = -length;
      const railX = -(1 - marble.x) * length + rock;

      // Played again from the end: the bell tips the marble into the snake's mouth, it travels down the body to the
      // tail at the ladder, and the ladder lifts it to the start. Asked of the playhead, not of the rolling marble,
      // which is still on its way back when the film restarts. Dragged back instead, the marble simply rolls.
      // The film leaves its end a moment before the playhead reports the start, so the leaving is held briefly.
      if (motion.wasEnded && !ended) motion.leftEnd = frame.now;
      if (motion.leftEnd && frame.now - motion.leftEnd > 0.4) motion.leftEnd = 0;
      if (motion.leftEnd && frame.state.played < 0.1 && marble.mode !== 'drag' && replay.t < 0) {
        motion.leftEnd = 0;
        if (!frame.calm) replay.t = 0;
      }
      motion.wasEnded = ended;
      const inBell = ended || motion.leftEnd > 0 || (replay.t >= 0 && replay.t < 0.05);
      busy = move(motion.drop, inBell ? 1 : 0, inBell ? 13 : 20, inBell ? 0.55 : 1, frame) || busy;
      busy = move(motion.grab, marble.mode === 'drag' ? 1 : 0, 40, 0.6, frame) || busy;

      const trayHome = scratch.set(startX - r - 6.5, rodY - shape.rodRadius - 1, 0).applyMatrix4(rail.matrixWorld).y - stage.floor;
      const tailY = tailEnd.y - stage.floor - snakeR * 0.6;
      tray.position.y = trayHome;
      ball.visible = true;
      ball.scale.setScalar(1 + 0.07 * motion.grab.x);
      mats.bulge.size.value = 0;
      bell.rotation.x = 0;

      if (replay.t >= 0) {
        replay.t += frame.dt;
        const t = replay.t;
        busy = true;

        if (t < 0.34) {
          // The bell tips toward the open mouth and the marble rolls out of it into the snake.
          const k = ease(t / 0.34);
          bell.rotation.x = Math.sin(k * Math.PI) * 0.7;
          const mouth = rail.worldToLocal(mouthAt.getWorldPosition(scratch));
          ball.position.lerpVectors(bowlRest, mouth, k);
          ball.position.y += Math.sin(k * Math.PI) * r * 0.8;
          ball.scale.setScalar(1 - 0.5 * ease(clamp((k - 0.6) / 0.4, 0, 1)));
        } else if (t < 1.14) {
          // Down the snake: the swelling travels from head to tail.
          const k = (t - 0.34) / 0.8;
          ball.visible = false;
          mats.bulge.at.value = 0.02 + 0.96 * ease(k);
          mats.bulge.size.value = snakeR * 0.62 * Math.min(1, k * 8, (1 - k) * 8);
        } else if (t < 1.5) {
          // Up the ladder on the tray.
          const k = ease((t - 1.14) / 0.36);
          tray.position.y = tailY + (trayHome - tailY) * k;
          ball.position.copy(rail.worldToLocal(scratch.set(ladderX, stage.floor + tray.position.y + r + 0.9, ladder.position.z + 2.5)));
        } else if (t < 1.75) {
          // Off the tray and after the playhead.
          const k = ease((t - 1.5) / 0.25);
          ball.position.set(startX - r - 6.5 + (railX - startX + r + 6.5) * k, ride, 0);
        } else {
          replay.t = -1;
        }
        ball.rotation.z = -marble.turn;
      } else {
        const d = motion.drop.x;
        ball.position.set(railX + (bowlRest.x - 0) * ease(clamp(d * 1.5, 0, 1)), ride + motion.grab.x * 1.5 + (bowlRest.y - ride) * ease(clamp(d * 1.5 - 0.3, 0, 1.2)), 0);
        ball.rotation.z = -marble.turn;
      }

      // Pause: a brass pin comes up just ahead of the marble.
      busy = move(motion.pin, paused && !ended && marble.mode === 'follow' ? 1 : 0, 46, 0.5, frame) || busy;
      pin.position.set(railX + r + shape.rodRadius + 1.2, top + shape.sleeper + pinHeight * (motion.pin.x - 0.5), 0);
      pin.visible = motion.pin.x > 0.02;

      // The bell rings as the marble lands.
      if (ended && Math.abs(motion.drop.x - 0.8) < 0.1 && Math.abs(ring.v) < 0.5 && Math.abs(ring.x) < 0.02 && motion.drop.v > 0.5) ring.v = 5;
      busy = move(ring, 0, 12, 0.09, frame) || busy;
      bell.rotation.z = ring.x * 0.22;
      return busy;
    });

    // Chapters: a chime bar hangs where each one starts, and swings when the marble passes.
    const swings = mem('chimes', () => ({ at: [] as Spring[], x: -1, started: false }));
    const bars = layout.chapters.map((chapter, index) => {
      const hang = put(rail, new Group(), -length + chapter.at * length, foot - 1, shape.chimeZ - shape.z);
      const barLength = Math.min(chapter.length, shape.chimeRows) / COS_P;
      mesh(hang, new CylinderGeometry(0.45, 0.45, 3, 5), mats.steel, 0, -1.5, 0, false);
      // Tubular bells: a round bar catches a line of light whatever the film shows.
      mesh(hang, new CylinderGeometry(shape.chimeRadius, shape.chimeRadius, barLength, 16), mats.brassPolished, 0, -3 - barLength / 2, 0);
      swings.at[index] ??= spring(0);
      return hang;
    });
    if (bars.length) mesh(rail, rod(0.6, length + 6, 6), mats.steel, -length / 2, foot - 1, shape.chimeZ - shape.z, false);
    for (const chapter of layout.chapters) {
      // Each bar hangs from a hook on the beam.
      const reach = shape.chimeZ - shape.z - halfFoot + 1;
      mesh(rail, new BoxGeometry(0.9, 0.9, reach), mats.brass, -length + chapter.at * length, foot - 0.6, halfFoot - 1 + reach / 2, false);
    }
    updaters.push((frame) => {
      const { x } = frame.state.marble;
      let busy = false;

      if (swings.x >= 0 && !frame.calm) {
        layout.chapters.forEach((chapter, index) => {
          const passed = index === 0 ? frame.state.started && !swings.started : (swings.x - chapter.at) * (x - chapter.at) < 0;
          if (passed) swings.at[index]!.v += (x >= swings.x ? -1 : 1) * 3.2;
        });
      }
      swings.x = x;
      swings.started = frame.state.started;
      bars.forEach((bar, index) => {
        busy = move(swings.at[index]!, 0, 13, 0.07, frame) || busy;
        bar.rotation.z = swings.at[index]!.x;
      });
      return busy;
    });

    // The film's length, engraved on a plate at the end of the rail.
    if (boxes.duration) {
      const { x, y, w, h } = boxes.duration;
      const stand = put(world, new Group(), x, heightAt(y, shape.z, H), shape.z);
      stand.rotation.x = -LEAN;
      mesh(stand, plate(w + 2, alongSlope(h) + 2, 2.6, 2, 0.7), mats.brass, 0, 0, -2.6);
      mesh(world, new CylinderGeometry(1.2, 1.6, stand.position.y - stage.floor, 8), mats.brassPolished, x, (stand.position.y + stage.floor) / 2 - 2, shape.z - 4);
    }
  }

  // ---------- Bench tier: one mechanism per control ----------

  // Play: a lever in a slot. Down is stopped, up is rolling.
  if (boxes.lever) {
    const { w, h } = boxes.lever;
    const hl = alongSlope(h);
    const group = key('lever', boxes.lever);
    const slotX = layout.tier === 'xxs' ? 0 : (layout.rtl ? 1 : -1) * (w / 2 - u * 4.25);
    const arm = put(group, new Group(), slotX, 0, 0.5);
    const swing = mem('lever', () => spring(1));

    mesh(group, plate(w, hl, KEY, u * 1.5), mats.brass, 0, 0, -KEY);
    mesh(group, plate(u * 2.25, hl * 0.72, 0.5, u * 1.1, 0.2), mats.dark, slotX, 0, 0, false);
    mesh(arm, post(1.7, 2.1, 15, 10), mats.steel);
    mesh(arm, new SphereGeometry(u * 2.1, 24, 16), mats.enamel, 0, 0, 16);
    updaters.push((frame) => {
      const busy = move(swing, frame.state.paused || frame.state.ended ? 1 : -1, 26, 0.5, frame);
      arm.rotation.x = swing.x * 0.96;
      return busy;
    });
  }

  // Skip: two pinball flippers. They rest turned a little and kick the other way.
  for (const name of ['back', 'fwd'] as const) {
    const box = boxes[name];
    if (!box) continue;
    const hl = alongSlope(box.h);
    const side = name === 'back' ? -1 : 1;
    const pivotX = side * (box.w / 2 - u * 2.25);
    const at = face(box, 6.5);
    const flipper = put(deck, new Group(), at.x + pivotX, at.y, 0);
    const big = hl / 2;
    const small = hl * 0.36;
    const reach = box.w - big - small;
    const lean = Math.asin(clamp((big - small) / reach, -1, 1));
    const outline = new Shape();
    const turn = mem(`flipper-${name}`, () => ({ angle: spring(side * 0.157), until: 0 }));

    // A tapered paddle: a big round end on the pivot, a smaller one at the tip.
    outline.absarc(0, 0, big, Math.PI / 2 - lean, Math.PI * 1.5 + lean, false);
    outline.absarc(reach, 0, small, -Math.PI / 2 + lean, Math.PI / 2 - lean, false);
    outline.closePath();
    const paddle = mesh(flipper, slab(outline, 6.5, 1.6), mats.ivory, -u * 2.25 + big, 0, 0);
    if (side === 1) {
      paddle.scale.x = -1;
      paddle.position.x = u * 2.25 - big;
    }
    mesh(flipper, post(u * 0.9, u * 1.05, 1.6, 16), mats.brassPolished, 0, 0, 6.5);
    updaters.push((frame) => {
      if (name === 'back' ? frame.events.kickBack : frame.events.kickForward) turn.until = frame.now + 0.11;
      const kicked = frame.pressed === name || frame.now < turn.until;
      const busy = move(turn.angle, side * (kicked ? -0.279 : 0.157), kicked ? 90 : 38, kicked ? 1 : 0.45, frame);
      flipper.rotation.z = turn.angle.x;
      return busy || frame.now < turn.until;
    });
  }

  // Time: a drum counter behind a brass window. Each drum turns a tenth for every digit.
  if (boxes.counter) {
    const { w, h } = boxes.counter;
    const hl = alongSlope(h);
    const at = face(boxes.counter, 7.5);
    const group = put(deck, new Group(), at.x, at.y, 0);
    const sag = 5.5;
    const drumRadius = ((hl / 2) ** 2 + sag ** 2) / (2 * sag);
    const cell = layout.counterAdvance || u * 3.2;
    const drums = Array.from({ length: 8 }, () => mesh(group, rod(drumRadius, cell - 1.3, 40), mats.drum, 0, 0, 7.5 - drumRadius, false));
    const turns = mem('counter', () => Array.from({ length: 8 }, () => spring(0)));

    mesh(group, bezel(w, hl, 6.5, 9.5, u), mats.brass);
    mesh(group, plate(w + 2, hl + 2, 0.6, u, 0.2), mats.dark, 0, 0, 0, false);
    updaters.push((frame) => {
      const cells = counterCells(frame.state.counter, 0, cell);
      let busy = false;

      drums.forEach((drum, index) => {
        const shown = cells[cells.length - 1 - index];
        const turnSpring = turns[index]!;
        drum.visible = !!shown;
        if (!shown) return;
        // The shortest way round to the new digit.
        const target = turnSpring.x + ((((drumTurn(shown.char) - turnSpring.x) % TAU) + TAU * 1.5) % TAU) - Math.PI;
        busy = move(turnSpring, Math.abs(target - turnSpring.x) < 0.001 ? turnSpring.x : target, 34, 0.8, frame) || busy;
        drum.position.x = shown.x;
        drum.rotation.x = -turnSpring.x;
      });
      return busy;
    });
  }

  // Mute: a cork on a wire bail. It swings into the brass horn, and out again with a pop.
  if (boxes.horn) {
    const radius = Math.min(boxes.horn.w, alongSlope(boxes.horn.h)) / 2;
    const group = key('horn', boxes.horn);
    const rim = 12;
    const hinge = put(group, new Group(), radius * 0.7, radius * 0.7, rim - KEY);
    const pop = mem('cork', () => spring(1));
    const axis = new Vector3(-1, 1, 0).normalize();

    mesh(
      group,
      turned([
        [radius * 0.5, 1.5],
        [radius * 0.57, 4],
        [radius * 0.73, 8],
        [radius * 0.9, 11],
        [radius * 0.99, rim],
        [radius * 1.03, rim - 0.6],
        [radius * 0.92, 8.5],
        [radius * 0.76, 4.5],
        [radius * 0.64, 0],
      ]),
      mats.brassHollow,
      0,
      0,
      -KEY
    );
    mesh(group, new CircleGeometry(radius * 0.56, 28), mats.felt, 0, 0, 2 - KEY, false);
    mesh(hinge, post(radius * 0.47, radius * 0.4, 9, 20), mats.cork, -radius * 0.7, -radius * 0.7, -rim + KEY - 3.5);
    mesh(hinge, new TorusGeometry(radius * 0.5, 0.7, 6, 20, Math.PI), mats.steel, -radius * 0.35, -radius * 0.35, 0.6, false).rotation.z = -Math.PI / 4;
    updaters.push((frame) => {
      const busy = move(pop, frame.state.muted ? 0 : 1, 21, 0.36, frame);
      hinge.quaternion.setFromAxisAngle(axis, pop.x * 2.15);
      return busy;
    });
  }

  // Volume: swell shutters. Slats open with the volume and the film's light leaks out between them.
  if (boxes.shutters) {
    const { w, h } = boxes.shutters;
    const tall = alongSlope(h - u * 4.5);
    const at = face(boxes.shutters, 7);
    const group = put(deck, new Group(), at.x, at.y, 0);
    const count = Math.max(4, Math.floor(w / 6.4));
    const slatWidth = w / count;
    const slats = new InstancedMesh(new BoxGeometry(slatWidth - 0.5, tall - 1, 1.1), mats.wood('bead', 0.2), count);
    const knob = mesh(group, new CapsuleGeometry(u * 1.35, alongSlope(h) * 0.86 - u * 2.7, 6, 14), mats.brassPolished, 0, 0, 9.5);
    const level = mem('shutters', () => spring(0));
    const dummy = new Object3D();
    const sign = layout.rtl ? -1 : 1;
    let drawnAt = -1;

    mesh(group, bezel(w, tall, 5, 7, 2), mats.brass);
    mesh(group, plate(w + 1, tall + 1, 0.5, 2, 0.2), mats.leak, 0, 0, 0, false);
    slats.castShadow = true;
    slats.receiveShadow = true;
    group.add(slats);
    updaters.push((frame) => {
      const busy = move(level, frame.state.volume, 30, 0.85, frame);
      if (level.x === drawnAt) return busy;
      drawnAt = level.x;
      const knobX = (level.x - 0.5) * w * sign;

      knob.position.x = knobX;
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) * slatWidth - w / 2;
        // Slats on the played side of the knob stand open, the rest lie shut.
        const open = ease(clamp(((knobX - x) * sign) / (slatWidth * 2.2) + 0.5, 0, 1));
        dummy.position.set(x, 0, 3.4);
        dummy.rotation.set(0, open * 1.25, 0);
        dummy.updateMatrix();
        slats.setMatrixAt(i, dummy.matrix);
      }
      slats.instanceMatrix.needsUpdate = true;
      return busy;
    });
  }

  // Speed: a ratchet jack. A die rides the rack, one tooth and one face for each of the six speeds.
  if (boxes.jack) {
    const { w, h } = boxes.jack;
    const hl = alongSlope(h);
    const group = key('jack', boxes.jack);
    const columnX = (layout.rtl ? 1 : -1) * (w / 2 - u * 3.6);
    const size = Math.min(u * 3.4, hl * 0.3);
    const travel = hl * 0.74 - size;
    const teeth = new Shape();
    const rackHeight = hl * 0.74;
    const die = mesh(group, new RoundedBoxGeometry(size, size, size, 3, size * 0.16), mats.die);
    const rolled = mem('die', () => ({ step: spring(2), spin: spring(1), from: new Quaternion(), to: new Quaternion(), face: -1 }));
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2);
    const turns: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      [0, -Math.PI / 2, 0],
      [Math.PI / 2, 0, 0],
      [-Math.PI / 2, 0, 0],
      [0, Math.PI / 2, 0],
      [Math.PI, 0, 0],
    ];
    const scratch = new Object3D();

    // A sawtooth rack behind the die.
    teeth.moveTo(-u * 0.9, -rackHeight / 2);
    for (let i = 0; i < 6; i++) {
      const y = -rackHeight / 2 + (i * rackHeight) / 6;
      teeth.lineTo(u * 0.9, y);
      teeth.lineTo(u * 0.25, y + rackHeight / 6);
    }
    teeth.lineTo(-u * 0.9, rackHeight / 2);
    teeth.closePath();
    mats.dieSize.value = size;
    mesh(group, plate(w, hl, KEY, u * 1.5), mats.brass, 0, 0, -KEY);
    mesh(group, plate(u * 3.3, rackHeight + 3, 0.5, 1.5, 0.2), mats.dark, columnX, 0, 0, false);
    mesh(group, slab(teeth, 1.6, 0.4), mats.steel, columnX, 0, 0.4);
    updaters.push((frame) => {
      const { rate } = frame.state;

      if (rolled.face !== rate) {
        scratch.rotation.set(...turns[rate]!);
        rolled.from.copy(die.quaternion);
        rolled.to.copy(yaw).multiply(scratch.quaternion);
        if (rolled.face === -1 || frame.calm) rolled.from.copy(rolled.to);
        rolled.face = rate;
        rolled.spin.x = 0;
        rolled.spin.v = 0;
      }
      const climbing = move(rolled.step, rate, 30, 0.6, frame);
      const tumbling = move(rolled.spin, 1, 17, 0.72, frame);
      die.quaternion.slerpQuaternions(rolled.from, rolled.to, clamp(rolled.spin.x, 0, 1.12));
      die.position.set(columnX, -travel / 2 + (rolled.step.x / 5) * travel, 2 + size / 2 + Math.sin(clamp(rolled.spin.x, 0, 1) * Math.PI) * size * 0.55);
      return climbing || tumbling;
    });
  }

  // Captions: the tape key. Latched down, a strip of printed tape feeds out above it.
  if (boxes.tapekey) {
    const { w, h } = boxes.tapekey;
    const hl = alongSlope(h);
    const group = key('tapekey', boxes.tapekey, (state) => state.captions);
    const at = face(boxes.tapekey, 1);
    const strip = mesh(deck, new BoxGeometry(w * 0.56, u * 2.6, 0.4), mats.paper, at.x, at.y + hl / 2 + 1.5, 1, false);
    const feed = mem('tape', () => spring(0));

    strip.geometry.translate(0, u * 1.3, 0);
    mesh(group, plate(w, hl, KEY, u * 1.5), mats.ivory, 0, 0, -KEY);
    // A roll of the printing tape on brass cheeks along the key's top edge: what the key feeds from.
    mesh(group, rod(u * 1.15, w * 0.62, 20), mats.paper, 0, hl / 2 - u * 1.2, 1.2);
    for (const side of [-1, 1]) mesh(group, rod(u * 1.45, 1.2, 20), mats.brassPolished, side * (w * 0.31 + 0.6), hl / 2 - u * 1.2, 1.2);
    mesh(deck, new BoxGeometry(w * 0.64, 1.6, 0.6), mats.dark, at.x, at.y + hl / 2 + 1.2, 0.1, false);
    updaters.push((frame) => {
      const busy = move(feed, frame.state.captions ? 1 : 0, 24, 0.55, frame);
      strip.scale.y = Math.max(0.0001, feed.x);
      strip.visible = feed.x > 0.01;
      return busy;
    });
  }

  // Picture-in-picture: a brass locket. While the film is away in its own window, so is the locket.
  if (boxes.locket) {
    const radius = Math.min(boxes.locket.w, alongSlope(boxes.locket.h)) / 2;
    const group = key('locket', boxes.locket);
    const away = mem('locket', () => spring(0));
    const locket = mesh(
      group,
      turned([
        [radius, 0],
        [radius, KEY - 2.4],
        [radius * 0.97, KEY - 0.6],
        [radius * 0.91, KEY],
        [radius * 0.87, KEY - 0.9],
        [radius * 0.82, KEY - 0.9],
        [radius * 0.78, KEY],
        [0, KEY],
      ]),
      mats.brassPolished,
      0,
      0,
      -KEY
    );
    mesh(deck, new CircleGeometry(radius * 0.93, 32), mats.felt, group.position.x, group.position.y, 0.3, false);
    mesh(deck, new TorusGeometry(u * 1.1, 1.1, 8, 20), mats.brassPolished, group.position.x, group.position.y + radius + u * 0.9, 1.4, false);
    updaters.push((frame) => {
      const busy = move(away, frame.state.pip ? 1 : 0, 15, 0.7, frame);
      const k = clamp(away.x, 0, 1);
      locket.position.set(k * radius * 1.6, k * radius * 2.4, -KEY + k * 46);
      locket.scale.setScalar(Math.max(0.0001, 1 - k));
      locket.visible = k < 0.985;
      return busy;
    });
  }

  // Cast and AirPlay: a catapult. Its arm lies cocked, and stands thrown while the film is on another screen.
  for (const name of ['cast', 'airplay'] as const) {
    const box = boxes[name];
    if (!box) continue;
    const hl = alongSlope(box.h);
    const group = key(name, box);
    const arm = put(group, new Group(), -box.w / 2 + u * 1.6, -hl / 2 + u * 1.6, 0.4);
    const thrown = mem(`catapult-${name}`, () => spring(0));

    mesh(group, plate(box.w, hl, KEY, u * 1.5), mats.wood('dark', 0.4), 0, 0, -KEY);
    mesh(arm, new BoxGeometry(box.w * 0.34, 3, 2.2), mats.brass, box.w * 0.17, 0, 1.1);
    mesh(arm, post(u * 0.7, u * 0.8, 2.6, 12), mats.brassPolished);
    mesh(arm, new SphereGeometry(u * 0.75, 12, 8), mats.enamel, box.w * 0.34, 0, 2.2);
    updaters.push((frame) => {
      const busy = move(thrown, frame.state[name] ? 1 : 0, 24, 0.3, frame);
      arm.rotation.z = 0.25 + thrown.x * 1.05;
      return busy;
    });
  }

  // Settings: a drawer in the bench. It slides out while its menu is open.
  if (boxes.drawer) {
    const { w, h } = boxes.drawer;
    const hl = alongSlope(h);
    const at = face(boxes.drawer, KEY + 1);
    const drawer = put(deck, new Group(), at.x, at.y, 0);
    const pull = mem('drawer', () => spring(0));
    const knob = u * 3.6;

    mesh(drawer, plate(w, hl, KEY + 1, u * 0.75, 1.3), mats.wood('drawer', 0.4));
    mesh(drawer, bezel(w - u * 3, hl - u * 3, 0.7, 0.6, u * 0.5), mats.dark, 0, 0, KEY + 0.7, false);
    mesh(
      drawer,
      turned([
        [knob * 0.5, 0],
        [knob * 0.5, 2.4],
        [knob, 3.6],
        [knob, 5],
        [knob * 0.86, 6],
        [0, 6],
      ]),
      mats.brassPolished,
      0,
      settle(6),
      KEY + 1
    );
    updaters.push((frame) => {
      const busy = move(pull, frame.state.drawer ? 1 : frame.pressed === 'drawer' ? -0.4 : 0, 28, 0.55, frame);
      drawer.position.z = pull.x * 12;
      return busy;
    });
  }

  // Full screen: a pull cord with a wooden bead.
  if (boxes.cord) {
    const { w, h } = boxes.cord;
    const hl = alongSlope(h);
    const half = Math.min(w, hl) / 2;
    const at = face(boxes.cord, half * 0.5);
    const bead = put(deck, new Group(), at.x, at.y, 0);
    const eyeletY = stage.deck.length - u * 1.2;
    const cord = mesh(deck, new CylinderGeometry(1.3, 1.3, 1, 8), mats.rope, at.x, 0, half * 0.3);
    const tug = mem('cord', () => spring(0));
    const ball = mesh(bead, new SphereGeometry(half, 32, 20), mats.wood('bead', 0.2), 0, 0, 0);

    ball.scale.z = 0.5;
    cord.geometry.translate(0, 0.5, 0);
    mesh(deck, new TorusGeometry(u * 0.8, 1, 8, 16), mats.brassPolished, at.x, eyeletY, 2, false);
    updaters.push((frame) => {
      const busy = move(tug, frame.pressed === 'cord' ? 1 : 0, 32, 0.32, frame);
      const top = at.y + hl / 2 - 3 - tug.x * alongSlope(4);
      bead.position.y = at.y - tug.x * alongSlope(4);
      cord.position.y = top;
      cord.scale.y = Math.max(0.01, eyeletY - top);
      return busy;
    });
  }

  return updaters;
}
