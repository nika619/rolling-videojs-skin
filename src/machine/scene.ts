/**
 * The 3D machine: a lazy chunk. It draws the bench under the DOM controls and never owns any state:
 * what it shows is read from the controls themselves, and where it shows it is read from their rectangles.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  type Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  VideoTexture,
  WebGLRenderer,
} from 'three';

import { type Activity, FRAME_WINDOW, frameGap, nextQuality, PIXEL_RATIO_CAP, PLAYBACK_FRAME_MS, type Quality } from './gate';
import { PITCH, railShape, type Stage, stage as stageOf } from './layout';
import { type FilmLight, LAMP, luminance, type Rgb, sameLight, smoothLight } from './light';
import { filmUniforms, Materials, readPalette } from './materials';
import { CONTROLS, type ControlName, type Layout, type MachineState, measure, readState } from './measure';
import { buildMachine, type Frame, type Memory, type Updater } from './parts';
import type { Post } from './post';

export interface MountOptions {
  /** `<rolling-machine>`: the canvas goes inside it. */
  readonly host: HTMLElement;
  readonly container: HTMLElement;
  readonly dock: HTMLElement;
  readonly quality: Exclude<Quality, 'flat'>;
  /** Drop a tier when frames run slow. Off when a host has fixed the quality. */
  readonly adaptive: boolean;
  /** The first frame is on the canvas: the flat artwork can step back. */
  onReady(): void;
  /** WebGL failed or the context was lost: back to the flat skin. */
  onLost(): void;
  onQuality(quality: Quality): void;
}

export interface MachineStats {
  quality: Quality;
  /** Frames drawn since the machine was mounted. */
  frames: number;
  /** Frames drawn in the last second. */
  fps: number;
  /** Time spent building and submitting the last frame, ms. */
  drawMs: number;
  /** Slowest gap between two free-running frames in the last window, ms. */
  worstMs: number;
  triangles: number;
  calls: number;
  /** Times every part was rebuilt: on a resize or a layout change, never while the film simply plays. */
  builds: number;
}

export interface Machine {
  readonly stats: MachineStats;
  readonly canvas: HTMLCanvasElement;
  setLight(light: FilmLight): void;
  /** The film's own picture, once it is known that it may be read. */
  setFilm(video: HTMLVideoElement | null): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const linear = ([r, g, b]: Rgb, into: Color): Color => into.setRGB(r, g, b, SRGBColorSpace);
/** The colour the key light leans toward: a lamp, not a screen. */
const warm = new Color(1, 0.86, 0.7);
const tint = new Color();

/** Attributes that move controls about; anything else only changes what a mechanism shows. */
const LAYOUT_ATTRIBUTES = new Set(['hidden', 'data-hidden', 'data-availability', 'class', 'dir']);

export function mount(options: MountOptions): Machine {
  const { host, container, dock } = options;
  const canvas = document.createElement('canvas');

  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'rl-machine-canvas';
  host.replaceChildren(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, 600, 2600);
  const film = filmUniforms();
  const materials = new Materials(film, readPalette(container));
  const world = new Group();
  const memory: Memory = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cleanup = new AbortController();
  const { signal } = cleanup;

  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  // Counted over every pass of a frame, so the numbers are the frame's.
  renderer.info.autoReset = false;

  // The camera looks down 30 degrees. Its frustum is the dock itself: one world unit is one CSS pixel.
  camera.position.set(0, Math.sin(PITCH) * 1500, Math.cos(PITCH) * 1500);
  camera.lookAt(0, 0, 0);
  film.uViewDir.value.set(0, -Math.sin(PITCH), -Math.cos(PITCH));

  // The film stands over the bench and lights it from above and behind; the key takes its colour.
  const key = new DirectionalLight(0xffffff, 3);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.7;
  key.shadow.radius = 2.4;
  // A soft lamp on the viewer's side keeps every face readable whatever the film does.
  const fill = new DirectionalLight(new Color().setRGB(1, 0.93, 0.82, SRGBColorSpace), 0.45);
  const zones = [new PointLight(0xffffff, 1, 0, 2), new PointLight(0xffffff, 1, 0, 2), new PointLight(0xffffff, 1, 0, 2)];
  scene.add(world, key, key.target, fill, fill.target, ...zones);

  const pmrem = new PMREMGenerator(renderer);
  const room = studio();
  const environment = pmrem.fromScene(room, 0.07);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.72;
  room.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
  pmrem.dispose();

  const stats: MachineStats = { quality: options.quality, frames: 0, fps: 0, drawMs: 0, worstMs: 0, triangles: 0, calls: 0, builds: 0 };
  let quality: Quality = options.quality;
  let post: Post | null = null;
  let postLoading = false;
  let layout: Layout | null = null;
  let stage: Stage | null = null;
  let state: MachineState = readState(dock);
  let updaters: Updater[] = [];
  let light: FilmLight = LAMP;
  let lightTarget: FilmLight = LAMP;
  let videoTexture: VideoTexture | null = null;
  let visible = true;
  let disposed = false;
  let ready = false;
  let raf = 0;
  let lastDraw = 0;
  let lastTick = 0;
  let lastFree = 0;
  let stirredAt = 0;
  let moving = false;
  let layoutDirty = true;
  /** Something the machine shows has changed since the last frame. */
  let drawWanted = true;
  /** The layout the parts were last built for, and whether the next check must rebuild whatever it finds. */
  let built = '';
  let forceBuild = true;
  let stateDirty = true;
  let pointerDown = false;
  let pressed: ControlName | null = null;
  let hovered: ControlName | null = null;
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');
  let pressedUntil = 0;
  let wake = 0;
  const free: number[] = [];
  const drawn: number[] = [];
  const events = { kickBack: false, kickForward: false };

  const controlAt = (target: EventTarget | null): ControlName | null => {
    if (!(target instanceof Element)) return null;
    return (Object.keys(CONTROLS) as ControlName[]).find((name) => target.closest(CONTROLS[name])) ?? null;
  };

  const request = (): void => {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  /** Something changed: draw, and treat the next quarter second as live. */
  const stir = (): void => {
    stateDirty = true;
    drawWanted = true;
    request();
  };

  /** The dock mutated: read it again, and draw only if what it says has changed. */
  const poke = (): void => {
    stateDirty = true;
    request();
  };

  const size = (): void => {
    if (!layout) return;
    const { width, height } = layout.bands;
    const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[quality]);

    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.right = width;
    camera.top = height;
    camera.updateProjectionMatrix();
    post?.setSize(width, height, ratio);
  };

  const rebuild = (): void => {
    layoutDirty = false;
    const next = measure(container, dock);
    // v10 toggles attributes that could move a control (hidden, data-availability) many times while a film
    // plays without moving anything: the parts are rebuilt only when a measured rectangle has really changed.
    const shape = JSON.stringify(next);
    if (shape === built && !forceBuild) return;
    built = shape;
    forceBuild = false;
    layout = next;
    drawWanted = true;
    if (layout.bands.width < 2 || layout.bands.height < 2) return;
    stage = stageOf(layout.bands, layout.filmRows);
    size();
    // The ruler stays in the DOM, burned into the beam: it moves down onto the beam's face as drawn.
    const shift = layout.rail ? `${(railShape(layout.rail, stage, layout.bands.height).faceRow - layout.rail.pivot).toFixed(2)}px` : '';
    if (dock.style.getPropertyValue('--rl-beam-shift') !== shift) dock.style.setProperty('--rl-beam-shift', shift);

    const { width } = layout.bands;
    const depth = -stage.lip.z + 40;

    film.uFilmRect.value.set(0, stage.film.y, width, stage.film.height);
    film.uFilmZ.value = stage.film.z;

    key.target.position.set(width / 2, 0, -depth / 2 + 20);
    key.position.copy(key.target.position).add({ x: 0, y: 0.978 * 700, z: -0.208 * 700 });
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -width / 2 - 30;
    shadowCamera.right = width / 2 + 30;
    shadowCamera.top = depth / 2 + 60;
    shadowCamera.bottom = -depth / 2 - 30;
    shadowCamera.near = 300;
    shadowCamera.far = 1100;
    shadowCamera.updateProjectionMatrix();
    const cap = Math.min(renderer.capabilities.maxTextureSize, quality === 'high' ? 4096 : 2048);
    const mapWidth = Math.min(cap, 2 ** Math.ceil(Math.log2(width * (quality === 'high' ? 2.6 : 1.4))));
    if (key.shadow.mapSize.x !== mapWidth) {
      key.shadow.mapSize.set(mapWidth, quality === 'high' ? 1024 : 512);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }

    fill.target.position.set(width / 2, 0, 0);
    fill.position.set(width / 2 - 350, 450, 800);
    const reach = Math.max(260, width * 0.26);
    zones.forEach((zone, index) => {
      zone.position.set((width * (index * 2 + 1)) / 6, stage!.floor + reach, stage!.film.z + 40);
      zone.userData.reach = reach;
    });

    clear(world);
    updaters = buildMachine({ materials, layout, stage, world, memory });
    stats.builds++;
    stateDirty = true;
  };

  const applyLight = (): void => {
    const { left, centre, right } = light;
    const mean: Rgb = [(left[0] + centre[0] + right[0]) / 3, (left[1] + centre[1] + right[1]) / 3, (left[2] + centre[2] + right[2]) / 3];
    const level = luminance(mean);

    linear(mean, key.color);
    // Keep the colour, lift the level: a dim frame still gives the bench its shadows.
    key.color.multiplyScalar(1 / Math.max(level, 0.12)).lerp(warm, 0.5);
    key.intensity = 1.7 + 1.0 * Math.min(1, level * 1.6);
    [left, centre, right].forEach((zone, index) => {
      const lamp = zones[index]!;
      // Half the film's saturation, then a third lamp: the wood takes the film's mood without being dyed by it.
      linear(zone, lamp.color);
      lamp.color.lerp(tint.setScalar(lamp.color.r * 0.2126 + lamp.color.g * 0.7152 + lamp.color.b * 0.0722), 0.5);
      lamp.color.lerp(tint.copy(warm).multiplyScalar(luminance(zone)), 0.35);
      lamp.intensity = 0.85 * (lamp.userData.reach as number) ** 2;
      linear(zone, film.uFilmZone.value[index]!);
    });
  };

  const frame = (now: number): void => {
    raf = 0;
    if (disposed || !visible || document.hidden) return;

    // Interaction draws at full rate: a hand on the machine, a thrown marble, the moments after an action, and
    // parts still moving while the film stands. A film simply playing moves the marble too, at no more than 30.
    const live = pointerDown || state.marble.mode !== 'follow' || now - stirredAt < 600 || (moving && (state.paused || state.ended));
    const activity: Activity = live ? 'interacting' : !state.paused && !state.ended ? 'playing' : 'settled';
    const gap = activity === 'interacting' ? frameGap(activity) : PLAYBACK_FRAME_MS;

    if (now - lastDraw < gap - 2) {
      raf = requestAnimationFrame(frame);
      return;
    }

    const started = performance.now();
    const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.1) : 1 / 60;
    lastTick = now;

    if (layoutDirty) rebuild();
    if (!layout || !stage) return;

    if (stateDirty) {
      stateDirty = false;
      const next = readState(dock, state);
      const jumped = Math.abs(next.marble.x - state.marble.x) > 0.004 || next.paused !== state.paused || next.rate !== state.rate;
      if (jumped || next.muted !== state.muted || next.drawer !== state.drawer || next.ended !== state.ended) stirredAt = now;
      if (JSON.stringify(next) !== JSON.stringify(state)) drawWanted = true;
      state = next;
    }
    if (pressed && pressedUntil && now > pressedUntil) pressed = null;
    // A mutation that changed nothing the machine shows draws nothing: v10 rewrites some attributes to the values
    // they already have while the film is paused, in WebKit many times a second.
    if (!drawWanted && !moving && !pressed && now - stirredAt >= 250 && sameLight(light, lightTarget, 0.002)) {
      lastTick = 0;
      return;
    }
    drawWanted = false;

    const calm = reducedMotion.matches;
    const step: Frame = { state, layout, stage, dt, now: now / 1000, calm, pressed, hovered, events };
    moving = false;
    for (const update of updaters) moving = update(step) || moving;
    events.kickBack = false;
    events.kickForward = false;

    if (!sameLight(light, lightTarget, 0.002)) {
      light = calm ? lightTarget : smoothLight(light, lightTarget, dt);
      moving = true;
    }
    applyLight();

    if (videoTexture) film.uFilmOn.value = videoTexture.image.readyState >= 2 ? 1 : 0;
    renderer.shadowMap.needsUpdate = true;
    renderer.info.reset();
    if (post) post.render(scene, camera);
    else renderer.render(scene, camera);

    // Frame gaps only count while frames follow each other without a pause.
    if (lastFree && now - lastFree < 100 && activity === 'interacting') {
      free.push(now - lastFree);
      if (free.length >= FRAME_WINDOW) {
        stats.worstMs = Math.max(...free);
        if (options.adaptive) lower(nextQuality(quality, free));
        free.length = 0;
      }
    }
    lastFree = now;
    lastDraw = now;
    drawn.push(now);
    while (drawn.length && now - drawn[0]! > 1000) drawn.shift();
    stats.frames++;
    stats.fps = drawn.length;
    stats.drawMs = performance.now() - started;
    stats.triangles = renderer.info.render.triangles;
    stats.calls = renderer.info.render.calls;

    if (!ready) {
      ready = true;
      options.onReady();
    }
    if (moving || now - stirredAt < 250) raf = requestAnimationFrame(frame);
    else lastTick = 0;
  };

  const lower = (next: Quality): void => {
    if (next === quality) return;
    quality = next;
    stats.quality = next;
    options.onQuality(next);
    if (next === 'flat') return;
    post?.dispose();
    post = null;
    layoutDirty = true;
    forceBuild = true;
    request();
  };

  // The high tier adds ambient occlusion and a gentle tilt-shift; they load after the first frame.
  const loadPost = (): void => {
    if (postLoading || quality !== 'high') return;
    postLoading = true;
    void import('./post').then(({ createPost }) => {
      if (disposed || quality !== 'high') return;
      post = createPost(renderer, scene, camera);
      size();
      request();
    });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList' || LAYOUT_ATTRIBUTES.has(record.attributeName ?? '')) layoutDirty = true;
    }
    poke();
  });
  observer.observe(dock, { attributes: true, childList: true, characterData: true, subtree: true });

  // The edition (wood tones, accent) and the tier are set on the player itself. So are the film's colours,
  // many times a second, by the film eye: those reach the machine through setLight, never as a rebuild.
  const withoutFilm = (style: string | null): string => (style ?? '').replace(/--rl-film-[a-z]+:[^;]*;?/g, '').trim();
  const skinObserver = new MutationObserver((records) => {
    const own = withoutFilm(container.getAttribute('style'));
    if (records.every((record) => record.attributeName === 'style' && withoutFilm(record.oldValue) === own)) return;
    materials.setPalette(readPalette(container));
    layoutDirty = true;
    stir();
  });
  skinObserver.observe(container, { attributes: true, attributeOldValue: true, attributeFilter: ['data-edition', 'data-tier', 'style', 'class', 'dir'] });

  const resize = new ResizeObserver(() => {
    layoutDirty = true;
    stir();
  });
  resize.observe(dock);

  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change',
    () => {
      materials.setPalette(readPalette(container));
      stir();
    },
    { signal }
  );
  reducedMotion.addEventListener('change', stir, { signal });
  document.addEventListener('visibilitychange', stir, { signal });

  dock.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = true;
      pressed = controlAt(event.target);
      pressedUntil = 0;
      stirredAt = performance.now();
      stir();
    },
    { signal, capture: true, passive: true }
  );
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(
      type,
      () => {
        if (!pointerDown) return;
        pointerDown = false;
        pressed = null;
        stirredAt = performance.now();
        stir();
      },
      { signal, capture: true, passive: true }
    );
  }
  // Under a mouse, the key the pointer is over rises a little to meet it.
  for (const type of ['pointerover', 'pointerout'] as const) {
    dock.addEventListener(
      type,
      (event) => {
        const next = type === 'pointerover' && canHover.matches ? controlAt(event.target) : null;
        if (next === hovered) return;
        hovered = next;
        stir();
      },
      { signal, passive: true }
    );
  }
  dock.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      pressed = controlAt(event.target);
      pressedUntil = performance.now() + 130;
      stirredAt = performance.now();
      stir();
    },
    { signal, capture: true }
  );
  dock.addEventListener(
    'click',
    (event) => {
      const name = controlAt(event.target);
      if (name === 'back') events.kickBack = true;
      if (name === 'fwd') events.kickForward = true;
      stirredAt = performance.now();
      stir();
    },
    { signal, capture: true }
  );

  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      options.onLost();
    },
    { signal }
  );

  request();
  // Shaders compile on the first frame; the extras for the high tier follow once it is out.
  wake = window.setTimeout(loadPost, 300);

  return {
    stats,
    canvas,
    setLight(next) {
      lightTarget = next;
      request();
    },
    setFilm(video) {
      if (videoTexture?.image === video) return;
      videoTexture?.dispose();
      videoTexture = null;
      film.uFilm.value = null;
      film.uFilmOn.value = 0;
      if (!video) return;

      videoTexture = new VideoTexture(video);
      // Sampled raw and decoded in the shader; mipmaps give the marble a clean reflection and the brass a soft one.
      videoTexture.colorSpace = NoColorSpace;
      videoTexture.generateMipmaps = true;
      videoTexture.minFilter = LinearMipmapLinearFilter;
      videoTexture.magFilter = LinearFilter;
      film.uFilm.value = videoTexture;
      drawWanted = true;
      request();
    },
    setVisible(next) {
      visible = next;
      if (next) stir();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(wake);
      cleanup.abort();
      observer.disconnect();
      skinObserver.disconnect();
      resize.disconnect();
      clear(world);
      post?.dispose();
      videoTexture?.dispose();
      key.shadow.map?.dispose();
      environment.dispose();
      materials.dispose();
      renderer.dispose();
      canvas.remove();
      dock.style.removeProperty('--rl-beam-shift');
    },
  };
}

/** Empty a group and free its geometry. Materials are shared and outlive a rebuild. */
function clear(group: Object3D): void {
  group.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
  group.clear();
}

/** A small studio for the metals to mirror: a warm soft box overhead and in front, strips at the sides, a dark floor. */
function studio(): Scene {
  const room = new Scene();
  const panel = (color: number, level: number, w: number, h: number, x: number, y: number, z: number, aim = true): void => {
    const mesh = new Mesh(new BoxGeometry(w, h, 0.2), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(level) }));
    mesh.position.set(x, y, z);
    if (aim) mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };

  room.background = new Color(0x2b221c);
  // Overhead and a little in front: what the plates on the deck mirror.
  panel(0xfff1dc, 1.7, 12, 6, 0, 9, 4);
  // Behind the viewer: what a ball mirrors in its middle.
  panel(0xfff6ea, 1.1, 11, 6, 0, 5, 8.7);
  // Low in front: what upright faces mirror.
  panel(0xffe6c4, 0.9, 14, 4, 0, -3.5, 9);
  panel(0xffe2bd, 1.4, 3, 7, -9, 2, 2);
  panel(0xffd9a8, 1.4, 3, 7, 9, 2, 2);
  panel(0xcfdcff, 0.5, 12, 4, 0, 3, -9);
  return room;
}
