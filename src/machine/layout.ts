/**
 * The geometry that ties the 3D machine to the DOM. The DOM is the layout truth: every mechanism is placed
 * so that it shows exactly where its control's rectangle is. Pure functions; `measure.ts` reads the rectangles.
 *
 * World: x to the right, y up, z toward the viewer, in CSS pixels. The camera is orthographic and looks
 * down 30 degrees, so screen x is world x and a screen row is one linear step from a point on the bench.
 */

/** Camera pitch below the horizon. */
export const PITCH = Math.PI / 6;
/** The control deck and the lip lean back this far from upright: 20 degrees off the line of sight, so a face on them keeps its shape under its DOM icon while its lower edge still shows. */
export const LEAN = (50 * Math.PI) / 180;
/** The deck's top edge sits this far into the bench band, leaving room for the chime bars above it. */
const RIDGE_INSET = 0.08;
/** The floor behind the deck, as a share of the deck's height. */
const FLOOR_SHARE = 0.42;

const SIN_P = Math.sin(PITCH);
const COS_P = Math.cos(PITCH);
const SIN_L = Math.sin(LEAN);
const COS_L = Math.cos(LEAN);
const SIN_O = Math.sin(LEAN - PITCH);
const COS_O = Math.cos(LEAN - PITCH);

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A rectangle in the dock: centre and size, in CSS pixels from the dock's top-left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a world point shows in the dock. */
export function project(p: Vec3, dockHeight: number): { x: number; y: number } {
  return { x: p.x, y: dockHeight - p.y * COS_P + p.z * SIN_P };
}

/** The depth at which a point of height `y` shows on screen row `row`. */
export function depthAt(row: number, y: number, dockHeight: number): number {
  return (row - dockHeight + y * COS_P) / SIN_P;
}

/** The height at which a point at depth `z` shows on screen row `row`. */
export function heightAt(row: number, z: number, dockHeight: number): number {
  return (dockHeight - row + z * SIN_P) / COS_P;
}

/** A leaning board (the deck, the lip). Its own coordinates: x across, y up the slope, z out of the face. */
export interface Panel {
  /** World height and depth of its foot. */
  readonly y: number;
  readonly z: number;
  /** Screen row of its foot. */
  readonly foot: number;
  /** Length up the slope. */
  readonly length: number;
}

export function panel(footRow: number, topRow: number, footY: number, dockHeight: number): Panel {
  return { y: footY, z: depthAt(footRow, footY, dockHeight), foot: footRow, length: (footRow - topRow) / COS_O };
}

/** Panel coordinates of the point that shows at (x, row) while standing `lift` off the face. */
export function onPanel(p: Panel, x: number, row: number, lift = 0): Vec3 {
  return { x, y: (p.foot - row - lift * SIN_O) / COS_O, z: lift };
}

/** How long something `rows` tall on screen is along the slope. */
export const alongSlope = (rows: number): number => rows / COS_O;
/** How far a face moves down the screen when it sinks `depth` into a panel. */
export const sinkRows = (depth: number): number => depth * SIN_O;

export function panelToWorld(p: Panel, local: Vec3): Vec3 {
  return { x: local.x, y: p.y + local.y * COS_L + local.z * SIN_L, z: p.z - local.y * SIN_L + local.z * COS_L };
}

/** The bands of the dock, as screen rows. */
export interface Bands {
  readonly width: number;
  readonly height: number;
  /** Bottom of the tape lip. */
  readonly lip: number;
  /** Top of the bench band. */
  readonly bench: number;
}

export interface Stage {
  /** The control deck: a console that slopes down toward the viewer. */
  readonly deck: Panel;
  /** The tape lip at the back, under the film. */
  readonly lip: Panel;
  /** World position of the deck's top edge, and the screen row it shows on. */
  readonly ridge: { readonly y: number; readonly z: number };
  readonly ridgeRow: number;
  /** Height of the floor the rail stands on, between the deck and the lip. */
  readonly floor: number;
  /** The film: an upright screen standing on the lip. */
  readonly film: { readonly z: number; readonly y: number; readonly height: number };
}

export function stage(bands: Bands, filmRows: number): Stage {
  const ridgeRow = bands.bench + (bands.height - bands.bench) * RIDGE_INSET;
  const deck = panel(bands.height, ridgeRow, 0, bands.height);
  const ridge = panelToWorld(deck, { x: 0, y: deck.length, z: 0 });
  const floor = ridge.y * FLOOR_SHARE;
  const lip = panel(bands.lip, 0, floor, bands.height);
  const lipTop = panelToWorld(lip, { x: 0, y: lip.length, z: 0 });

  return {
    deck,
    lip,
    ridge: { y: ridge.y, z: ridge.z },
    ridgeRow,
    floor,
    film: { z: lipTop.z - 2, y: lipTop.y, height: Math.max(filmRows, 1) / COS_P },
  };
}

/** The rail as the DOM lays it out, in dock pixels, before the speed jack tilts it. */
export interface RailBox {
  /** Screen x of the marble's centre at the start and at the end of the film. */
  readonly start: number;
  readonly end: number;
  /** Row of the beam's top line: the tilt pivots on it at the bell end. */
  readonly pivot: number;
  /** Row of the marble's centre. */
  readonly marble: number;
  /** Marble radius. */
  readonly radius: number;
  /** Height of the beam's face. */
  readonly beam: number;
  /** How far the beam runs past each end. */
  readonly over: number;
  /** Length of the longest chime bar. */
  readonly chime: number;
}

/** The rail in the world, measured from the marble: a steel ball resting on two rods. */
export interface RailShape {
  /** Depth of the rail's centre line. */
  readonly z: number;
  /** Height of the marble's centre. */
  readonly marbleY: number;
  /** Distance between the two rods, their radius and the height of their centres. */
  readonly rodGap: number;
  readonly rodRadius: number;
  readonly rodY: number;
  /** Thickness of a sleeper. */
  readonly sleeper: number;
  /** The beam: height of its top, its width at the top and at the foot, and its height. */
  readonly beamTop: number;
  readonly beamTopWidth: number;
  readonly beamFootWidth: number;
  readonly beamHeight: number;
  /** Row where the beam's face begins on screen: the ruler burned into it follows this. */
  readonly faceRow: number;
  /** The snake under the rail: its thickness, the height of its middle and its depth. */
  readonly snakeRadius: number;
  readonly snakeY: number;
  readonly snakeZ: number;
  /** The chime bars: the depth they hang at, in front of the snake, their thickness, and the longest one that fits. */
  readonly chimeZ: number;
  readonly chimeRadius: number;
  readonly chimeRows: number;
}

export function railShape(box: RailBox, s: Stage, dockHeight: number): RailShape {
  const r = box.radius;
  const rodGap = r * 0.92;
  const rodRadius = Math.max(1.3, r * 0.14);
  const sleeper = Math.max(1.5, r * 0.17);
  const beamTopWidth = rodGap + 2 * (rodRadius + r * 0.22);
  const beamFootWidth = beamTopWidth + r * 0.85;
  const lean = (beamFootWidth - beamTopWidth) / 2;
  // The camera has no perspective, so rows do not depend on depth: the face can be placed before the rail is.
  const marbleOverBeam = Math.sqrt((r + rodRadius) ** 2 - (rodGap / 2) ** 2) + rodRadius + sleeper;
  const faceRow = box.marble + marbleOverBeam * COS_P + (beamTopWidth / 2) * SIN_P;
  const footRow = faceRow + box.beam;
  // Between the beam and the deck's ridge: the snake lies tucked under the beam, and the chime bars hang in front of it.
  const strip = s.ridgeRow - footRow;
  const snakeRadius = Math.max(1.5, Math.min(r * 0.56, (strip - 2) / 2));
  // Tubular bells, full enough to catch a line of light across the room.
  const chimeRadius = Math.max(1.8, r * 0.27);
  // How far the snake shows in front of the beam's foot.
  const reach = snakeRadius * 0.7;
  // From the back: beam and snake, chime bars, then the ridge of the deck.
  const z = s.ridge.z - beamFootWidth / 2 - reach - chimeRadius * 2 - 3;
  const snakeZ = z + beamFootWidth / 2 + reach - snakeRadius;
  const chimeZ = z + beamFootWidth / 2 + reach + chimeRadius + 1;
  const marbleY = heightAt(box.marble, z, dockHeight);
  const rodY = marbleY - Math.sqrt((r + rodRadius) ** 2 - (rodGap / 2) ** 2);
  const beamTop = rodY - rodRadius - sleeper;
  const beamHeight = Math.max(4, (box.beam - lean * SIN_P) / COS_P);
  // Set back under the beam it would show a little higher: this much lower, its back meets the beam's foot.
  const snakeY = beamTop - beamHeight - snakeRadius * 1.33 - 0.6;
  // A bar starts at the beam's foot and may reach the ridge, no further.
  const chimeTop = footRow + (chimeZ - z - beamFootWidth / 2) * SIN_P + 1.5;

  return {
    z,
    marbleY,
    rodGap,
    rodRadius,
    rodY,
    sleeper,
    beamTop,
    beamTopWidth,
    beamFootWidth,
    beamHeight,
    faceRow,
    snakeRadius,
    snakeY,
    snakeZ,
    chimeZ,
    chimeRadius,
    chimeRows: Math.max(3, Math.min(box.chime, s.ridgeRow - chimeTop)),
  };
}

/** The angle the rail turns in the world so that it shows the DOM's tilt on screen. Degrees in, radians out. */
export function worldTilt(degrees: number): number {
  return Math.atan(Math.tan((degrees * Math.PI) / 180) / COS_P);
}

/** The cells of the drum counter: one drum per character, centred in the window. */
export function counterCells(text: string, centre: number, advance: number): { char: string; x: number }[] {
  const chars = [...text.trim()];
  return chars.map((char, index) => ({ char, x: centre + (index - (chars.length - 1) / 2) * advance }));
}

/** The turn of a counter drum for a character: a tenth of a turn per digit, anything else rests at zero. */
export function drumTurn(char: string): number {
  const digit = char.charCodeAt(0) - 48;
  return digit >= 0 && digit <= 9 ? (digit / 10) * Math.PI * 2 : 0;
}
