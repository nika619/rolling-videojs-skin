/**
 * `<rolling-tape>`: the caption tape. It prints the cues of whichever captions or subtitles track is showing on a paper
 * strip in the lip under the picture, so captions never sit on the film or under the controls (Video.js issues 9420
 * and 9303). The browser's own cue box is hidden by the skin's CSS; the captions button and menu work as before,
 * because the tape only reads the tracks' modes and never sets them.
 */
export class RollingTapeElement extends HTMLElement {
  readonly #paper = document.createElement('span');
  readonly #line = document.createElement('span');
  readonly #ink = document.createElement('span');
  #tracks: TextTrackList | null = null;
  #track: TextTrack | null = null;
  #text = '';

  connectedCallback(): void {
    this.#paper.className = 'rl-tape-paper';
    this.#line.className = 'rl-tape-line';
    this.#ink.className = 'rl-tape-ink';
    this.#line.append(this.#ink);
    this.#paper.append(this.#line);
    this.append(this.#paper);
    // The media is a sibling inside the same container; wait a frame so it is parsed and upgraded.
    requestAnimationFrame(this.#attach);
  }

  disconnectedCallback(): void {
    this.#tracks?.removeEventListener('change', this.#pick);
    this.#tracks?.removeEventListener('addtrack', this.#pick);
    this.#track?.removeEventListener('cuechange', this.#render);
    this.#tracks = this.#track = null;
  }

  /** The text on the tape now: what a test or the 3D machine can read. */
  get text(): string {
    return this.#text;
  }

  readonly #attach = (): void => {
    const media = this.closest('media-container')?.querySelector<HTMLMediaElement>('video, mux-video');
    if (!media?.textTracks || !this.isConnected) return;
    this.#tracks = media.textTracks;
    this.#tracks.addEventListener('change', this.#pick);
    this.#tracks.addEventListener('addtrack', this.#pick);
    this.#pick();
  };

  readonly #pick = (): void => {
    const showing =
      [...(this.#tracks ?? [])].find((t) => t.mode === 'showing' && (t.kind === 'captions' || t.kind === 'subtitles')) ?? null;
    if (showing !== this.#track) {
      this.#track?.removeEventListener('cuechange', this.#render);
      showing?.addEventListener('cuechange', this.#render);
      this.#track = showing;
    }
    this.toggleAttribute('data-showing', showing !== null);
    this.#render();
  };

  readonly #render = (): void => {
    const cues = this.#track?.activeCues;
    const text = cues ? [...cues].map((cue) => cueText(cue)).join('\n') : '';
    if (text === this.#text) return;
    this.#text = text;
    this.#ink.textContent = text;
    this.toggleAttribute('data-text', text !== '');
    // Print it: restart the sweep, its length set by the number of characters.
    this.#line.style.setProperty('--rl-print-chars', String(Math.max(text.length, 1)));
    this.#line.classList.remove('rl-print');
    if (text) {
      void this.#line.offsetWidth;
      this.#line.classList.add('rl-print');
      // The sound of the carriage follows the sweep's own length (none with reduced motion).
      const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(text.length * 22, 1100);
      this.dispatchEvent(new CustomEvent('rolling-print', { bubbles: true, detail: { chars: text.length, ms } }));
    }
  };
}

/** A cue's words without WebVTT tags (voice, class, timestamps) or entities. */
export function cueText(cue: TextTrackCue): string {
  const raw = (cue as VTTCue).text ?? '';
  const words = raw.replace(/<[^>]*>/g, '');
  return words.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) =>
    ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏' })[name] ?? '',
  );
}

if (!customElements.get('rolling-tape')) customElements.define('rolling-tape', RollingTapeElement);
