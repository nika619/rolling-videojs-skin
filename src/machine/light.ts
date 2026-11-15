/**
 * The film lights the machine. A tiny canvas reads the current frame and gives three colours: the left,
 * the centre and the right of the picture. They drive the lights over the 3D bench and, as CSS variables,
 * a glow on the flat skin. Where the film cannot be read (a cross-origin source), a fixed warm lamp stands in.
 */

/** sRGB, 0 to 1. */
export type Rgb = readonly [number, number, number];

export interface FilmLight {
  readonly left: Rgb;
  readonly centre: Rgb;
  readonly right: Rgb;
}

/** The workshop lamp: what lights the bench before the film shows a frame, or when it cannot be read. */
export const LAMP: FilmLight = {
  left: [1, 0.74, 0.5],
  centre: [1, 0.8, 0.58],
  right: [1, 0.74, 0.5],
};

export const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Mean colour of the left, centre and right thirds of an RGBA frame. */
export function zoneMeans(pixels: ArrayLike<number>, width: number, height: number): FilmLight {
  const sums = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const zone = Math.min(2, Math.floor((x * 3) / width));
      const at = (y * width + x) * 4;
      sums[zone * 3] += pixels[at]!;
      sums[zone * 3 + 1] += pixels[at + 1]!;
      sums[zone * 3 + 2] += pixels[at + 2]!;
      counts[zone]!++;
    }
  }

  const zone = (i: number): Rgb => {
    const n = Math.max(1, counts[i]!) * 255;
    return [sums[i * 3]! / n, sums[i * 3 + 1]! / n, sums[i * 3 + 2]! / n];
  };
  return { left: zone(0), centre: zone(1), right: zone(2) };
}

/**
 * A dark frame must not put the bench in the dark: below `floor` the lamp is mixed in,
 * so text and icons keep their contrast whatever the film shows.
 */
export function withLamp(light: FilmLight, floor = 0.16): FilmLight {
  const lift = (zone: Rgb, lamp: Rgb): Rgb => {
    const lum = luminance(zone);
    return lum >= floor ? zone : mix(zone, lamp.map((c) => c * floor * 1.6) as unknown as Rgb, 1 - lum / floor);
  };
  return { left: lift(light.left, LAMP.left), centre: lift(light.centre, LAMP.centre), right: lift(light.right, LAMP.right) };
}

/** Ease one light toward another. `tau` is the time, in seconds, to cover about two thirds of the way. */
export function smoothLight(from: FilmLight, to: FilmLight, dt: number, tau = 0.3): FilmLight {
  const t = dt <= 0 ? 0 : 1 - Math.exp(-dt / tau);
  return { left: mix(from.left, to.left, t), centre: mix(from.centre, to.centre, t), right: mix(from.right, to.right, t) };
}

export const sameLight = (a: FilmLight, b: FilmLight, tolerance = 0.004): boolean =>
  (['left', 'centre', 'right'] as const).every((zone) => a[zone].every((c, i) => Math.abs(c - b[zone][i]!) <= tolerance));

const css = ([r, g, b]: Rgb): string => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

/** Width and height of the canvas the frame is read through. */
const EYE = [32, 18] as const;
/** Shortest time between two readings, in ms: the light is smoothed anyway. */
const READ_GAP_MS = 80;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Watches the film and reports its light. */
export class FilmEye {
  /** False once the film has refused to be read; the lamp is used from then on. */
  readable = true;
  /** True once a frame of the film has been read: its picture may be used. */
  sampled = false;
  /** The latest reading, lamp included. */
  light: FilmLight = LAMP;

  readonly #video: FrameVideo;
  readonly #target: HTMLElement;
  readonly #onLight: (light: FilmLight) => void;
  readonly #context: CanvasRenderingContext2D | null;
  #cleanup: AbortController | null = null;
  #handle = 0;
  #last = 0;

  constructor(video: HTMLVideoElement, target: HTMLElement, onLight: (light: FilmLight) => void) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = EYE;

    this.#video = video;
    this.#target = target;
    this.#onLight = onLight;
    this.#context = canvas.getContext('2d', { willReadFrequently: true });
  }

  start(): void {
    if (this.#cleanup) return;
    this.#cleanup = new AbortController();
    const { signal } = this.#cleanup;

    for (const type of ['loadeddata', 'seeked', 'playing', 'emptied'] as const) {
      this.#video.addEventListener(type, this.#read, { signal });
    }
    // Browsers without per-frame callbacks still report the time a few times a second.
    if (!this.#video.requestVideoFrameCallback) this.#video.addEventListener('timeupdate', this.#read, { signal });
    this.#watch();
    this.#read();
  }

  stop(): void {
    this.#cleanup?.abort();
    this.#cleanup = null;
    if (this.#handle) this.#video.cancelVideoFrameCallback?.(this.#handle);
    this.#handle = 0;
  }

  #watch(): void {
    if (!this.#cleanup || !this.#video.requestVideoFrameCallback) return;
    this.#handle = this.#video.requestVideoFrameCallback(() => {
      this.#handle = 0;
      if (performance.now() - this.#last >= READ_GAP_MS) this.#read();
      this.#watch();
    });
  }

  readonly #read = (): void => {
    this.#last = performance.now();
    let light = LAMP;

    if (this.readable && this.#context && this.#video.readyState >= 2 && this.#video.videoWidth > 0) {
      try {
        this.#context.drawImage(this.#video, 0, 0, EYE[0], EYE[1]);
        light = withLamp(zoneMeans(this.#context.getImageData(0, 0, EYE[0], EYE[1]).data, EYE[0], EYE[1]));
        this.sampled = true;
      } catch {
        // A cross-origin film without CORS taints the canvas: keep the lamp and stop asking.
        this.readable = false;
      }
    }

    if (sameLight(light, this.light)) return;
    this.light = light;
    this.#target.style.setProperty('--rl-film-left', css(light.left));
    this.#target.style.setProperty('--rl-film-centre', css(light.centre));
    this.#target.style.setProperty('--rl-film-right', css(light.right));
    this.#onLight(light);
  };
}

/** The `<video>` behind a media element, which may be a custom element that keeps it in its shadow tree. */
export function videoOf(media: Element | null): HTMLVideoElement | null {
  if (!media) return null;
  if (media instanceof HTMLVideoElement) return media;
  const host = media as Element & { target?: unknown; video?: unknown };
  const found = host.target ?? host.video ?? media.shadowRoot?.querySelector('video') ?? media.querySelector('video');
  return found instanceof HTMLVideoElement ? found : null;
}
