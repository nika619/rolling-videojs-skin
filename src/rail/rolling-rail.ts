import {
  PlayerController,
  type PropertyValues,
  playerContext,
  selectPlayback,
  selectPlaybackRate,
  selectTime,
  UIElement,
} from '@videojs/html';

import {
  clamp,
  createMarble,
  flickVelocity,
  isSettled,
  type Marble,
  type PointerSample,
  playheadNow,
  RAIL_FEEL,
  release,
  rockOffset,
  stepMarble,
} from './physics';
import { rulerTicks } from './ruler';

/** What the rail needs from the player store. The shared context does not type it. */
interface TimeState {
  currentTime: number;
  duration: number;
  seeking: boolean;
  seek(time: number): Promise<number>;
}
interface PlaybackState {
  paused: boolean;
  ended: boolean;
  waiting: boolean;
  started: boolean;
}
interface RateState {
  playbackRate: number;
}

/** Seconds between seeks while the marble glides: the time slider's own drag throttle. */
const GLIDE_SEEK_INTERVAL = 0.1;
/** Plain playback needs no more than 30 frames a second. */
const PLAYBACK_FRAME_MS = 31;
/** Degrees of slope at normal speed. The speed jack lifts the left end: steeper is faster. */
const TILT_PER_RATE = 0.4;

/**
 * The rail: a steel marble that is the playhead.
 *
 * The time slider inside stays the real control (pointer, keyboard, ARIA). This element only decides
 * where the marble is drawn, and keeps the film seeking while a flicked marble rolls on.
 */
export class RollingRailElement extends UIElement {
  readonly #time = new PlayerController(this, playerContext, selectTime);
  readonly #playback = new PlayerController(this, playerContext, selectPlayback);
  readonly #rate = new PlayerController(this, playerContext, selectPlaybackRate);
  readonly #reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  #marble: Marble = createMarble();
  #samples: PointerSample[] = [];
  #pointer: number | null = null;
  #pointerId = -1;
  #reported = { time: Number.NaN, at: 0 };
  #rockAt = Number.NEGATIVE_INFINITY;
  #lastSeek = 0;
  #settling = false;
  #wasPaused = true;
  #frame = 0;
  #lastStep = 0;
  #length = 0;
  #radius = 10;
  #rulerKey = '';
  #painted = '';
  #onScreen = true;
  #slider: HTMLElement | null = null;
  #ruler: HTMLElement | null = null;
  #cleanup: AbortController | null = null;
  #resize: ResizeObserver | null = null;
  #visibility: IntersectionObserver | null = null;

  /** The marble right now. Read by tests and by the machine that will be drawn around it. */
  get marble(): Readonly<Marble> {
    return this.#marble;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = new AbortController();
    const { signal } = this.#cleanup;

    this.#slider = this.querySelector<HTMLElement>('media-time-slider');
    this.#ruler = this.querySelector<HTMLElement>('.rl-ruler');

    const slider = this.#slider;
    if (!slider) return;

    // Capture phase: the slider keeps its pointer events to itself once it has handled them.
    slider.addEventListener('pointerdown', this.#grab, { signal, capture: true });
    window.addEventListener('pointermove', this.#drag, { signal, capture: true, passive: true });
    window.addEventListener('pointerup', this.#letGo, { signal, capture: true });
    window.addEventListener('pointercancel', this.#letGo, { signal, capture: true });
    this.#reducedMotion.addEventListener('change', this.#wake, { signal });

    this.#resize = new ResizeObserver(() => {
      this.#measure();
      this.#wake();
    });
    this.#resize.observe(slider);

    this.#visibility = new IntersectionObserver(([entry]) => {
      this.#onScreen = entry?.isIntersecting ?? true;
      if (this.#onScreen) this.#wake();
    });
    this.#visibility.observe(this);

    this.#measure();
    this.#wake();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = null;
    this.#resize?.disconnect();
    this.#visibility?.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed);

    const now = performance.now() / 1000;
    const time = this.#timeState;
    const playback = this.#playbackState;
    const rate = this.#rateState?.playbackRate ?? 1;

    if (time && time.currentTime !== this.#reported.time) this.#reported = { time: time.currentTime, at: now };

    if (playback) {
      // The pin comes up ahead of the marble and the marble knocks against it.
      if (playback.paused && !this.#wasPaused && !playback.ended && this.#marble.mode === 'follow') this.#rockAt = now;
      this.#wasPaused = playback.paused;
    }

    this.toggleAttribute('data-paused', playback?.paused ?? true);
    this.toggleAttribute('data-ended', playback?.ended ?? false);
    this.toggleAttribute('data-waiting', playback?.waiting ?? false);
    this.toggleAttribute('data-started', playback?.started ?? false);

    const tilt = clamp(TILT_PER_RATE * rate, 0.2, 0.8);
    this.style.setProperty('--rl-tilt', tilt.toFixed(3));
    this.style.setProperty('--rl-rise', `${(Math.tan((tilt * Math.PI) / 180) * this.#length).toFixed(1)}px`);

    this.#renderRuler();
    this.#wake();
  }

  get #timeState(): TimeState | undefined {
    return this.#time.value as TimeState | undefined;
  }

  get #playbackState(): PlaybackState | undefined {
    return this.#playback.value as PlaybackState | undefined;
  }

  get #rateState(): RateState | undefined {
    return this.#rate.value as RateState | undefined;
  }

  get #rtl(): boolean {
    return getComputedStyle(this).direction === 'rtl';
  }

  #measure(): void {
    const slider = this.#slider;
    if (!slider) return;

    this.#length = slider.clientWidth;
    this.#radius = (this.querySelector<HTMLElement>('.rl-marble')?.offsetWidth ?? 20) / 2;
    this.#renderRuler();
    this.requestUpdate();
  }

  /** Minutes burned into the beam. Decorative: the slider's own value is what assistive technology reads. */
  #renderRuler(): void {
    const ruler = this.#ruler;
    const duration = this.#timeState?.duration ?? 0;
    const key = `${Math.round(duration * 10)}|${Math.round(this.#length)}`;

    if (!ruler || key === this.#rulerKey) return;
    this.#rulerKey = key;

    ruler.replaceChildren(
      ...rulerTicks(duration, this.#length).map((tick) => {
        const mark = document.createElement('i');
        mark.className = 'rl-tick';
        mark.dataset.rank = String(tick.rank);
        mark.style.insetInlineStart = `${(tick.frac * 100).toFixed(3)}%`;
        if (tick.label) mark.textContent = tick.label;
        return mark;
      })
    );
  }

  #pointerFraction(event: PointerEvent): number {
    const rect = this.#slider!.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;

    return clamp(this.#rtl ? 1 - fraction : fraction, 0, 1);
  }

  #sample(event: PointerEvent): void {
    this.#pointer = this.#pointerFraction(event);
    this.#samples.push({ t: event.timeStamp / 1000, x: this.#pointer });
    if (this.#samples.length > 12) this.#samples.shift();
  }

  readonly #grab = (event: PointerEvent): void => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!((this.#timeState?.duration ?? 0) > 0)) return;

    this.#pointerId = event.pointerId;
    this.#samples = [];
    this.#settling = false;
    this.#sample(event);
    this.#marble = { ...this.#marble, mode: 'drag' };
    this.#wake();
  };

  readonly #drag = (event: PointerEvent): void => {
    if (this.#marble.mode !== 'drag' || event.pointerId !== this.#pointerId) return;
    this.#sample(event);
    this.#wake();
  };

  readonly #letGo = (event: PointerEvent): void => {
    if (this.#marble.mode !== 'drag' || event.pointerId !== this.#pointerId) return;

    const now = event.timeStamp / 1000;
    const velocity = event.type === 'pointercancel' ? 0 : flickVelocity(this.#samples, now);

    this.#marble = release(this.#marble, velocity, this.#reducedMotion.matches);
    this.#pointer = null;
    this.#pointerId = -1;
    // The slider has just sought to where the pointer let go; the next seek belongs to the glide.
    this.#lastSeek = performance.now() / 1000;
    this.#wake();
  };

  /** Keep the film under a gliding marble. `final` is the exact seek once it has come to rest. */
  #seek(now: number, final: boolean): void {
    const time = this.#timeState;
    if (!time || !(time.duration > 0)) return;

    this.#lastSeek = now;
    const done = time.seek(this.#marble.x * time.duration);
    if (!final) return;

    // Hold the marble where it stopped until the film has caught up, so it never springs back.
    this.#settling = true;
    const release = (): void => {
      if (!this.#settling) return;
      this.#settling = false;
      this.#reported = { time: this.#timeState?.currentTime ?? 0, at: performance.now() / 1000 };
      this.#wake();
    };
    void Promise.resolve(done).then(release, release);
    setTimeout(release, 800);
  }

  readonly #wake = (): void => {
    if (this.#frame || !this.isConnected || !this.#onScreen) return;
    this.#frame = requestAnimationFrame(this.#step);
  };

  readonly #step = (nowMs: number): void => {
    this.#frame = 0;

    const now = nowMs / 1000;
    const time = this.#timeState;
    const playback = this.#playbackState;
    const duration = time?.duration ?? 0;
    const waiting = playback?.waiting ?? false;
    const playing = !!playback && !playback.paused && !playback.ended && !waiting && !time?.seeking;
    const reducedMotion = this.#reducedMotion.matches;
    const rocking = now - this.#rockAt < 1.2;
    const before = this.#marble;
    const target = this.#settling
      ? before.x
      : playheadNow(this.#reported.time || 0, now - this.#reported.at, this.#rateState?.playbackRate ?? 1, playing, duration);
    const plain = before.mode === 'follow' && playing && !rocking && isSettled(before, target);

    // Nothing but the film is moving: half the frames are enough.
    if (plain && nowMs - this.#lastStep < PLAYBACK_FRAME_MS) {
      this.#frame = requestAnimationFrame(this.#step);
      return;
    }

    const dt = this.#lastStep ? Math.min((nowMs - this.#lastStep) / 1000, 0.25) : 1 / 60;
    this.#lastStep = nowMs;

    let marble = stepMarble(before, dt, { target, pointer: this.#pointer, reducedMotion }, {
      length: this.#length,
      radius: this.#radius,
      ...RAIL_FEEL,
    });

    // Waiting for data: the marble spins in place against the pin.
    if (waiting && !reducedMotion) marble = { ...marble, turn: marble.turn + dt * 9 };

    this.#marble = marble;

    if (before.mode === 'glide') {
      if (marble.mode !== 'glide') this.#seek(now, true);
      else if (now - this.#lastSeek >= GLIDE_SEEK_INTERVAL) this.#seek(now, false);
    }

    this.#paint(reducedMotion ? 0 : rockOffset(now - this.#rockAt, this.#radius * 0.5));

    const busy = marble.mode !== 'follow' || this.#settling || playing || waiting || rocking || !isSettled(marble, target);
    if (busy) this.#frame = requestAnimationFrame(this.#step);
    else this.#lastStep = 0;
  };

  #paint(rock: number): void {
    const { x, turn, mode } = this.#marble;
    const painted = `${x.toFixed(5)}|${turn.toFixed(3)}|${rock.toFixed(2)}|${mode}`;

    if (painted === this.#painted) return;
    this.#painted = painted;

    this.style.setProperty('--rl-left', `${(x * 100).toFixed(3)}%`);
    this.style.setProperty('--rl-turn', `${turn.toFixed(3)}rad`);
    this.style.setProperty('--rl-rock', `${rock.toFixed(2)}px`);
    this.dataset.mode = mode;
  }
}

if (!customElements.get('rolling-rail')) customElements.define('rolling-rail', RollingRailElement);

declare global {
  interface HTMLElementTagNameMap {
    'rolling-rail': RollingRailElement;
  }
}
