import { PlayerController, playerContext, selectPlayback, UIElement } from '@videojs/html';

import { type Tier, tierFor } from '../rail/ruler';

import { type Device, machineMode, type Quality, startQuality } from './gate';
import { FilmEye, videoOf } from './light';
import type { Machine, MachineStats } from './scene';

interface PlaybackState {
  started: boolean;
  play(): Promise<void>;
}

interface Probe extends Device {
  readonly webgl: boolean;
}

let probed: Probe | undefined;

/** Is WebGL 2 there, and what draws it? Asked once per page, on a context that is given straight back. */
function probe(): Probe {
  if (probed) return probed;
  let renderer = '';
  let webgl = false;

  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      webgl = true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl = false;
  }

  const { hardwareConcurrency: cores = 4, deviceMemory: memory } = navigator as Navigator & { deviceMemory?: number };
  probed = { webgl, renderer, cores, memory };
  return probed;
}

/** The user asked for less data: the 3D chunk is never fetched. */
const savesData = (): boolean =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true ||
  matchMedia('(prefers-reduced-data: reduce)').matches;

const QUALITY_KEY = 'rolling-quality';

/**
 * The machine as a whole. It has no interface of its own: it reports the size tier on the player
 * (`data-tier`, the same thresholds as the container queries), lets a first touch on the film start it,
 * watches the film's light, and mounts the 3D machine under the controls when the player can carry it.
 *
 * `quality="flat"` keeps the flat skin; `quality="high"` or `"standard"` fixes the tier. Left alone, the
 * machine starts where the device suggests and steps down by itself if frames run slow.
 * The player's `data-machine` is `3d` while the canvas is showing, and `flat` otherwise.
 */
export class RollingMachineElement extends UIElement {
  readonly #playback = new PlayerController(this, playerContext, selectPlayback);
  readonly #forcedColors = matchMedia('(forced-colors: active)');

  #cleanup: AbortController | null = null;
  #resize: ResizeObserver | null = null;
  #visibility: IntersectionObserver | null = null;
  #touch: { id: number; x: number; y: number; at: number } | null = null;
  #player: HTMLElement | null = null;
  #dock: HTMLElement | null = null;
  #eye: FilmEye | null = null;
  #machine: Machine | null = null;
  #mounting = false;
  #failed = false;
  #seen = false;
  #onScreen = false;
  #tier: Tier = 'xl';
  #quality: Quality = 'high';
  #adaptive = true;

  /** `3d` while the canvas is showing. */
  get mode(): 'flat' | '3d' {
    return this.#player?.dataset.machine === '3d' ? '3d' : 'flat';
  }

  get quality(): Quality {
    return this.#machine ? this.#quality : 'flat';
  }

  /** Frame counts and timings of the 3D machine, for tests and for measuring the frame budget. */
  get stats(): MachineStats | null {
    return this.#machine?.stats ?? null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = new AbortController();
    const { signal } = this.#cleanup;
    const player = this.closest<HTMLElement>('media-container');

    this.#player = player;
    if (!player) return;
    this.#dock = player.querySelector<HTMLElement>('.rl-dock');
    this.setAttribute('aria-hidden', 'true');
    player.dataset.machine = 'flat';

    const asked = this.getAttribute('quality');
    const remembered = this.#remembered();
    this.#adaptive = asked !== 'high' && asked !== 'standard';
    this.#quality = asked === 'flat' || asked === 'high' || asked === 'standard' ? asked : (remembered ?? 'high');

    this.#resize = new ResizeObserver(([entry]) => {
      this.#tier = tierFor(entry?.contentBoxSize[0]?.inlineSize ?? player.clientWidth);
      player.dataset.tier = this.#tier;
      this.#gate();
    });
    this.#resize.observe(player);

    // A little before it scrolls into view, so the machine is there when the player is.
    this.#visibility = new IntersectionObserver(
      ([entry]) => {
        this.#onScreen = entry?.isIntersecting ?? false;
        if (this.#onScreen) this.#seen = true;
        this.#machine?.setVisible(this.#onScreen);
        this.#watchFilm();
        this.#gate();
      },
      { rootMargin: '200px' }
    );
    this.#visibility.observe(player);
    this.#forcedColors.addEventListener('change', () => this.#gate(), { signal });

    player.addEventListener('pointerdown', this.#touchStart, { signal, passive: true });
    player.addEventListener('pointerup', this.#touchEnd, { signal });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = null;
    this.#resize?.disconnect();
    this.#visibility?.disconnect();
    this.#eye?.stop();
    this.#eye = null;
    this.#unmount();
  }

  #remembered(): Quality | null {
    try {
      const value = sessionStorage.getItem(QUALITY_KEY);
      return value === 'flat' || value === 'standard' ? value : null;
    } catch {
      return null;
    }
  }

  /** The film's light is read while the player is on screen, for the 3D bench and for the flat skin alike. */
  #watchFilm(): void {
    const player = this.#player;
    if (!player) return;

    if (!this.#eye) {
      const video = videoOf(player.firstElementChild);
      if (!video) return;
      this.#eye = new FilmEye(video, player, (light) => {
        this.#machine?.setLight(light);
        this.#showFilm();
      });
    }
    if (this.#onScreen) this.#eye.start();
    else this.#eye.stop();
  }

  /** Hand the film's own picture to the machine, once it is known that it may be read. */
  #showFilm(): void {
    const eye = this.#eye;
    if (!eye || !this.#machine) return;
    this.#machine.setFilm(eye.readable && eye.sampled ? videoOf(this.#player?.firstElementChild ?? null) : null);
  }

  #gate(): void {
    const { webgl, ...device } = probe();
    if (this.#adaptive && this.#quality === 'high' && !this.#machine) this.#quality = startQuality(device);

    const mode = machineMode({
      webgl: webgl && !this.#failed,
      saveData: savesData(),
      forcedColors: this.#forcedColors.matches,
      tier: this.#tier,
      seen: this.#seen,
      quality: this.#quality,
    });

    if (mode === '3d') this.#mount();
    else this.#unmount();
  }

  #mount(): void {
    const player = this.#player;
    const dock = this.#dock;
    if (this.#machine || this.#mounting || !player || !dock) return;

    this.#mounting = true;
    void import('./scene')
      .then(({ mount }) => {
        this.#mounting = false;
        if (!this.isConnected || this.#failed || this.#quality === 'flat' || this.#machine) return;

        this.#machine = mount({
          host: this,
          container: player,
          dock,
          quality: this.#quality,
          adaptive: this.#adaptive,
          onReady: () => {
            if (this.#machine) player.dataset.machine = '3d';
          },
          onLost: () => {
            this.#failed = true;
            this.#unmount();
          },
          onQuality: (quality) => {
            this.#quality = quality;
            try {
              sessionStorage.setItem(QUALITY_KEY, quality);
            } catch {
              // Private windows may refuse storage; the tier then holds for this page only.
            }
            if (quality === 'flat') this.#unmount();
          },
        });
        this.#machine.setVisible(this.#onScreen);
        if (this.#eye) this.#machine.setLight(this.#eye.light);
        this.#showFilm();
        // The gate may have closed while the chunk was on its way.
        this.#gate();
      })
      .catch(() => {
        this.#mounting = false;
        this.#failed = true;
        this.#unmount();
      });
  }

  /** Back to the flat skin. Nothing is lost: the controls were the state all along. */
  #unmount(): void {
    if (this.#player) this.#player.dataset.machine = 'flat';
    this.#machine?.dispose();
    this.#machine = null;
  }

  readonly #touchStart = (event: PointerEvent): void => {
    this.#touch =
      event.pointerType === 'mouse' ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
  };

  /**
   * Before the film has started, a tap on the picture is the lever. A mouse click already plays through the
   * tap gesture; on touch that gesture shows and hides the controls, which says nothing while the dock is on show.
   */
  readonly #touchEnd = (event: PointerEvent): void => {
    const touch = this.#touch;
    const playback = this.#playback.value as PlaybackState | undefined;

    this.#touch = null;
    if (!touch || touch.id !== event.pointerId || !playback || playback.started) return;
    if (event.timeStamp - touch.at > 400 || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) return;
    if ((event.target as Element).closest('[data-interactive], [role="alertdialog"], button, a')) return;

    void playback.play().catch(() => {});
  };
}

if (!customElements.get('rolling-machine')) customElements.define('rolling-machine', RollingMachineElement);

declare global {
  interface HTMLElementTagNameMap {
    'rolling-machine': RollingMachineElement;
  }
}
