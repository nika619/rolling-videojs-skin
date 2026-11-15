import { PlayerController, playerContext, selectPlayback, UIElement } from '@videojs/html';

import { tierFor } from '../rail/ruler';

interface PlaybackState {
  started: boolean;
  play(): Promise<void>;
}

/**
 * The machine as a whole. It has no interface of its own: it reports the size tier on the player
 * (`data-tier`, the same thresholds as the container queries) and lets a first touch on the film start it.
 * The 3D machine will be mounted from here.
 */
export class RollingMachineElement extends UIElement {
  readonly #playback = new PlayerController(this, playerContext, selectPlayback);

  #cleanup: AbortController | null = null;
  #resize: ResizeObserver | null = null;
  #touch: { id: number; x: number; y: number; at: number } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = new AbortController();
    const { signal } = this.#cleanup;
    const player = this.closest<HTMLElement>('media-container');

    if (!player) return;

    this.#resize = new ResizeObserver(([entry]) => {
      player.dataset.tier = tierFor(entry?.contentBoxSize[0]?.inlineSize ?? player.clientWidth);
    });
    this.#resize.observe(player);

    player.addEventListener('pointerdown', this.#touchStart, { signal, passive: true });
    player.addEventListener('pointerup', this.#touchEnd, { signal });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#cleanup?.abort();
    this.#cleanup = null;
    this.#resize?.disconnect();
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
