/**
 * `<rolling-sound>`: the machine's voice, synthesized with Web Audio, no sound files. Each action sounds like its own
 * mechanism: the lever's clack and the pin dropping, the marble knocking the pin, a chime tuned to each chapter (a
 * pentatonic scale, so any order is in tune), the bell at the end, the snake's gulp and the ladder's rungs, the cork's
 * pop, the shutters' slats, the ratchet's teeth and the die, the paper feed and the carriage ticking as captions print,
 * the locket's snap, the drawer's slide and the cord.
 *
 * Sound never surprises: nothing plays before a hand has touched the player, nothing plays while the film is muted or
 * at zero volume, everything is scaled to the film's volume and kept under it, and the drawer has a switch (remembered).
 * It reads only the media element's events and the controls' attributes, like the 3D machine; it never sets state.
 */
const PENTATONIC = [0, 2, 4, 7, 9];
const STORE = 'rolling-sound';

type Voice = (ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer) => void;

export class RollingSoundElement extends HTMLElement {
  #ctx: AudioContext | null = null;
  #out: GainNode | null = null;
  #noise: AudioBuffer | null = null;
  #media: HTMLMediaElement | null = null;
  #container: HTMLElement | null = null;
  #observer: MutationObserver | null = null;
  #awake = false;
  #on = localStorage.getItem(STORE) !== 'off';
  #chapter = -1;
  #ended = false;
  #muted = false;
  #volume = 1;
  #rate = 1;
  #drawer = false;
  #lastTick = 0;
  #replayAt = -Infinity;
  /** How many sounds have played, by name: for tests. */
  readonly played: Record<string, number> = {};

  get enabled(): boolean {
    return this.#on;
  }

  set enabled(on: boolean) {
    this.#on = on;
    localStorage.setItem(STORE, on ? 'on' : 'off');
    this.#syncSwitch();
  }

  connectedCallback(): void {
    requestAnimationFrame(this.#attach);
  }

  disconnectedCallback(): void {
    this.#observer?.disconnect();
    this.#container?.removeEventListener('pointerdown', this.#wake, true);
    this.#container?.removeEventListener('keydown', this.#wake, true);
    void this.#ctx?.close();
    this.#ctx = null;
  }

  readonly #attach = (): void => {
    const container = this.closest<HTMLElement>('media-container');
    const media = container?.querySelector<HTMLMediaElement>('video, mux-video');
    if (!container || !media) return;
    this.#container = container;
    this.#media = media;
    this.#muted = media.muted;
    this.#volume = media.volume;
    this.#rate = media.playbackRate;
    container.addEventListener('pointerdown', this.#wake, true);
    container.addEventListener('keydown', this.#wake, true);
    media.addEventListener('play', this.#onPlay);
    media.addEventListener('pause', this.#onPause);
    media.addEventListener('ended', () => this.#play('bell'));
    media.addEventListener('timeupdate', this.#onTime);
    media.addEventListener('seeked', this.#onTime);
    media.addEventListener('volumechange', this.#onVolume);
    media.addEventListener('ratechange', this.#onRate);
    media.addEventListener('enterpictureinpicture', () => this.#play('snap'));
    media.addEventListener('leavepictureinpicture', () => this.#play('snap'));
    media.textTracks?.addEventListener('change', this.#onCaptions);
    document.addEventListener('fullscreenchange', this.#onFullscreen);
    container.addEventListener('rolling-print', this.#onPrint as EventListener);
    const sw = container.querySelector('.rl-sound-item');
    sw?.addEventListener('checked-change', () => (this.enabled = (sw as HTMLElement & { checked: boolean }).checked));
    this.#syncSwitch();
    // The drawer: its button reports open through aria-expanded.
    const drawer = container.querySelector('#rl-settings');
    if (drawer) {
      this.#observer = new MutationObserver(() => {
        const open = drawer.getAttribute('aria-expanded') === 'true';
        if (open !== this.#drawer) this.#play(open ? 'slide' : 'shut');
        this.#drawer = open;
      });
      this.#observer.observe(drawer, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
  };

  #syncSwitch(): void {
    const sw = this.#container?.querySelector('.rl-sound-item') as (HTMLElement & { checked: boolean }) | null;
    if (sw && sw.checked !== this.#on) sw.checked = this.#on;
  }

  /** The first touch or key on the player unlocks audio; until then the machine is silent. */
  readonly #wake = (): void => {
    if (!this.#ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.#ctx = new Context({ latencyHint: 'interactive' });
      this.#out = this.#ctx.createGain();
      const limiter = this.#ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 8;
      this.#out.connect(limiter).connect(this.#ctx.destination);
      this.#noise = this.#ctx.createBuffer(1, this.#ctx.sampleRate, this.#ctx.sampleRate);
      const data = this.#noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    this.#awake = true;
  };

  #play(name: keyof typeof VOICES, delay = 0): void {
    const media = this.#media;
    const ctx = this.#ctx;
    if (!this.#awake || !this.#on || !ctx || !this.#out || !this.#noise || !media || media.muted || media.volume === 0) return;
    // Under the film: at most about half its loudness, following its volume.
    this.#out.gain.value = 0.55 * media.volume;
    VOICES[name](ctx, this.#out, ctx.currentTime + 0.005 + delay, this.#noise);
    this.played[name] = (this.played[name] ?? 0) + 1;
  }

  readonly #onPlay = (): void => {
    if (this.#ended) {
      this.#replayAt = performance.now();
      // Replay: the bell tips the marble into the snake, the bulge runs to its tail, the ladder lifts it.
      this.#play('gulp');
      this.#play('rungs', 0.55);
    } else {
      this.#play('lever');
    }
    this.#ended = false;
  };

  readonly #onPause = (): void => {
    if (this.#media?.ended) {
      this.#ended = true;
      return;
    }
    this.#play('knock');
  };

  /** A chime for each chapter the marble enters, in order, whether it rolls there or is flicked across several. */
  readonly #onTime = (): void => {
    const media = this.#media!;
    const chapters = [...(media.textTracks ?? [])].find((t) => t.kind === 'chapters');
    const cues = chapters?.cues ? [...chapters.cues] : [];
    const index = cues.findIndex((c) => media.currentTime >= c.startTime && media.currentTime < c.endTime);
    if (index < 0 || index === this.#chapter) return;
    const from = this.#chapter;
    this.#chapter = index;
    // The first reading, and the trip home on replay (the snake carries the marble, it does not roll back), stay silent.
    if (from < 0 || performance.now() - this.#replayAt < 2000) return;
    const step = index > from ? 1 : -1;
    const passed = Math.min(Math.abs(index - from), 7);
    for (let i = 1; i <= passed; i++) {
      const chapter = from + step * i;
      this.#ringChime(chapter, (i - 1) * 0.085);
    }
  };

  #ringChime(chapter: number, delay: number): void {
    const semis = PENTATONIC[chapter % 5] + 12 * Math.floor(chapter / 5);
    CHIME_FREQ.value = 587.33 * 2 ** (semis / 12);
    this.#play('chime', delay);
  }

  readonly #onVolume = (): void => {
    const media = this.#media!;
    if (media.muted !== this.#muted) {
      this.#muted = media.muted;
      if (!media.muted) this.#play('pop');
    } else if (Math.abs(media.volume - this.#volume) > 0.02 && performance.now() - this.#lastTick > 70) {
      this.#lastTick = performance.now();
      this.#play('slat');
    }
    this.#volume = media.volume;
  };

  readonly #onRate = (): void => {
    const rate = this.#media!.playbackRate;
    if (rate === this.#rate) return;
    this.#rate = rate;
    this.#play('ratchet');
    this.#play('die', 0.16);
  };

  readonly #onCaptions = (): void => {
    const showing = [...(this.#media?.textTracks ?? [])].some((t) => t.mode === 'showing' && t.kind !== 'chapters');
    if (showing !== this.#container?.hasAttribute('data-rl-captions')) {
      this.#container?.toggleAttribute('data-rl-captions', showing);
      this.#play('feed');
    }
  };

  readonly #onPrint = (event: CustomEvent<{ chars: number; ms: number }>): void => {
    // The carriage ticks across the line, every few characters, very quietly.
    const ticks = event.detail.ms > 0 ? Math.min(Math.ceil(event.detail.chars / 3), 24) : 1;
    for (let i = 0; i < ticks; i++) this.#play('tick', (i * event.detail.ms) / ticks / 1000);
  };

  readonly #onFullscreen = (): void => {
    if (this.#container && (document.fullscreenElement === this.#container || !document.fullscreenElement)) this.#play('cord');
  };
}

/** The chime's pitch for the next ring (set just before it plays). */
const CHIME_FREQ = { value: 587.33 };

function env(ctx: AudioContext, out: AudioNode, t: number, peak: number, decay: number, attack = 0.002): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

/** A filtered burst of noise: wood, paper, metal, depending on the band. */
function burst(ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer, freq: number, q: number, peak: number, decay: number): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  source.connect(band).connect(env(ctx, out, t, peak, decay));
  source.start(t, Math.random() * 0.5, decay + 0.05);
}

/** A struck tone: partials as [ratio, level, decay seconds]. */
function struck(ctx: AudioContext, out: AudioNode, t: number, freq: number, peak: number, partials: [number, number, number][], drop = 1): void {
  for (const [ratio, level, decay] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * ratio * drop, t);
    if (drop !== 1) osc.frequency.exponentialRampToValueAtTime(freq * ratio, t + 0.025);
    osc.connect(env(ctx, out, t, peak * level, decay, 0.0015));
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

const VOICES = {
  lever: (ctx, out, t, n) => {
    struck(ctx, out, t, 210, 0.5, [[1, 1, 0.09], [2.3, 0.3, 0.05]], 1.4);
    burst(ctx, out, t, n, 1900, 2, 0.35, 0.04);
    // The pin drops and bounces.
    struck(ctx, out, t + 0.12, 2900, 0.12, [[1, 1, 0.08], [2.4, 0.4, 0.05]]);
    struck(ctx, out, t + 0.2, 2900, 0.05, [[1, 1, 0.05]]);
  },
  knock: (ctx, out, t, n) => {
    // The pin rises, the marble knocks against it and rocks.
    struck(ctx, out, t, 2600, 0.08, [[1, 1, 0.06]]);
    struck(ctx, out, t + 0.06, 1500, 0.3, [[1, 1, 0.12], [2.7, 0.35, 0.06]], 1.2);
    burst(ctx, out, t + 0.06, n, 3200, 3, 0.12, 0.02);
    struck(ctx, out, t + 0.19, 1500, 0.1, [[1, 1, 0.08]]);
  },
  chime: (ctx, out, t) => {
    // A tuned tube: strong fundamental, inharmonic upper partials that die first.
    struck(ctx, out, t, CHIME_FREQ.value, 0.28, [[1, 1, 2.4], [2.76, 0.42, 1.2], [5.4, 0.2, 0.55], [8.93, 0.08, 0.3]]);
  },
  bell: (ctx, out, t, n) => {
    burst(ctx, out, t, n, 2400, 1.5, 0.25, 0.05);
    struck(ctx, out, t, 392, 0.4, [[0.5, 0.5, 4.2], [1, 1, 3.4], [1.19, 0.5, 2.6], [1.56, 0.35, 2], [2, 0.3, 1.6], [2.51, 0.2, 1.1], [3.01, 0.1, 0.8]]);
  },
  gulp: (ctx, out, t) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(62, t + 0.22);
    osc.connect(env(ctx, out, t, 0.5, 0.26, 0.01));
    osc.start(t);
    osc.stop(t + 0.3);
  },
  rungs: (ctx, out, t, n) => {
    for (let i = 0; i < 6; i++) {
      struck(ctx, out, t + i * 0.14, 900 + i * 120, 0.12, [[1, 1, 0.07], [2.2, 0.3, 0.04]]);
      burst(ctx, out, t + i * 0.14, n, 1400 + i * 150, 4, 0.06, 0.02);
    }
  },
  pop: (ctx, out, t, n) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(1150, t);
    osc.frequency.exponentialRampToValueAtTime(330, t + 0.04);
    osc.connect(env(ctx, out, t, 0.45, 0.06, 0.001));
    osc.start(t);
    osc.stop(t + 0.1);
    burst(ctx, out, t, n, 2200, 1.2, 0.3, 0.025);
    // The cork bounces on its bail.
    struck(ctx, out, t + 0.16, 700, 0.08, [[1, 1, 0.05]]);
  },
  slat: (ctx, out, t, n) => burst(ctx, out, t, n, 2600, 6, 0.1, 0.018),
  ratchet: (ctx, out, t, n) => {
    for (let i = 0; i < 3; i++) {
      burst(ctx, out, t + i * 0.045, n, 3600, 9, 0.22, 0.02);
      struck(ctx, out, t + i * 0.045, 1900, 0.05, [[1, 1, 0.03]]);
    }
  },
  die: (ctx, out, t, n) => {
    burst(ctx, out, t, n, 1700, 5, 0.25, 0.03);
    burst(ctx, out, t + 0.1, n, 1800, 5, 0.12, 0.025);
    burst(ctx, out, t + 0.16, n, 1900, 5, 0.05, 0.02);
  },
  feed: (ctx, out, t, n) => {
    const source = ctx.createBufferSource();
    source.buffer = n;
    const low = ctx.createBiquadFilter();
    low.type = 'bandpass';
    low.Q.value = 0.8;
    low.frequency.setValueAtTime(2400, t);
    low.frequency.linearRampToValueAtTime(4800, t + 0.22);
    source.connect(low).connect(env(ctx, out, t, 0.08, 0.24, 0.03));
    source.start(t, 0, 0.3);
  },
  tick: (ctx, out, t, n) => burst(ctx, out, t, n, 5200, 10, 0.05, 0.01),
  snap: (ctx, out, t, n) => {
    struck(ctx, out, t, 3400, 0.12, [[1, 1, 0.05], [1.5, 0.5, 0.03]]);
    struck(ctx, out, t + 0.045, 2500, 0.09, [[1, 1, 0.06]]);
    burst(ctx, out, t, n, 6000, 3, 0.08, 0.015);
  },
  slide: (ctx, out, t, n) => {
    const source = ctx.createBufferSource();
    source.buffer = n;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(380, t);
    low.frequency.linearRampToValueAtTime(1300, t + 0.28);
    source.connect(low).connect(env(ctx, out, t, 0.22, 0.3, 0.05));
    source.start(t, 0, 0.4);
    struck(ctx, out, t + 0.3, 520, 0.18, [[1, 1, 0.08], [2.6, 0.3, 0.04]]);
  },
  shut: (ctx, out, t, n) => {
    burst(ctx, out, t, n, 600, 1, 0.12, 0.12);
    struck(ctx, out, t + 0.12, 440, 0.22, [[1, 1, 0.09], [2.6, 0.3, 0.04]]);
  },
  cord: (ctx, out, t, n) => {
    const source = ctx.createBufferSource();
    source.buffer = n;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(500, t);
    band.frequency.exponentialRampToValueAtTime(1600, t + 0.16);
    source.connect(band).connect(env(ctx, out, t, 0.12, 0.18, 0.02));
    source.start(t, 0, 0.25);
    struck(ctx, out, t + 0.18, 1200, 0.1, [[1, 1, 0.05]]);
  },
} satisfies Record<string, Voice>;

if (!customElements.get('rolling-sound')) customElements.define('rolling-sound', RollingSoundElement);
