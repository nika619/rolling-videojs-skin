/**
 * Materials for the machine. Everything is made in code: three.js physical materials with shader patches,
 * no texture files. The wood is a solid texture (growth rings, fibres, pores, end grain where a board is cut),
 * so every board is different and every cut end is right.
 */
import {
  Color,
  DoubleSide,
  type IUniform,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  type Texture,
  Vector3,
  Vector4,
} from 'three';

/** Uniforms every material shares: the film as a light and as a picture to reflect. */
export interface FilmUniforms {
  [name: string]: IUniform;
  uFilm: IUniform<Texture | null>;
  /** 1 when the film's picture can be sampled, 0 when only its three colours are known. */
  uFilmOn: IUniform<number>;
  /** The film in the world: x and y of its lower left corner, then width and height. */
  uFilmRect: IUniform<Vector4>;
  uFilmZ: IUniform<number>;
  /** Left, centre and right colour of the frame, linear. */
  uFilmZone: IUniform<Color[]>;
  uFilmGain: IUniform<number>;
  /** The way the camera looks, in the world. */
  uViewDir: IUniform<Vector3>;
}

export function filmUniforms(): FilmUniforms {
  return {
    uFilm: { value: null },
    uFilmOn: { value: 0 },
    uFilmRect: { value: new Vector4(0, 0, 1, 1) },
    uFilmZ: { value: -300 },
    uFilmZone: { value: [new Color(1, 0.5, 0.25), new Color(1, 0.6, 0.3), new Color(1, 0.5, 0.25)] },
    uFilmGain: { value: 1 },
    uViewDir: { value: new Vector3(0, -0.5, -0.866) },
  };
}

const SHARED = /* glsl */ `
uniform sampler2D uFilm;
uniform float uFilmOn;
uniform vec4 uFilmRect;
uniform float uFilmZ;
uniform vec3 uFilmZone[3];
uniform float uFilmGain;
uniform vec3 uViewDir;
varying vec3 vRlObj;
varying vec3 vRlWorld;
varying vec2 vRlUv;
float rlH = 0.0;

float rlHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rlNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rlHash(i), rlHash(i + vec3(1, 0, 0)), f.x), mix(rlHash(i + vec3(0, 1, 0)), rlHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(rlHash(i + vec3(0, 0, 1)), rlHash(i + vec3(1, 0, 1)), f.x), mix(rlHash(i + vec3(0, 1, 1)), rlHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float rlFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) { sum += amp * rlNoise(p); p = p * 2.03 + 7.1; amp *= 0.5; }
  return sum / 0.875;
}
// A height field bends the normal: grain you can see the light catch.
vec3 rlBump(vec3 n, float h, float strength) {
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  return normalize(abs(det) * n - strength * sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
}
vec3 rlWorldNormal(vec3 n) { return normalize((vec4(n, 0.0) * viewMatrix).xyz); }
vec3 rlZone(float u) {
  return mix(mix(uFilmZone[0], uFilmZone[1], smoothstep(0.1, 0.5, u)), uFilmZone[2], smoothstep(0.5, 0.9, u));
}
vec3 rlToLinear(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
// What a ray leaving p along r sees of the film. wrap 0: the upright screen itself, a true mirror image.
// wrap 1: the screen bent overhead like a canopy, so a ball shows the whole picture.
vec3 rlFilm(vec3 p, vec3 r, float lod, float wrap) {
  float t = (uFilmZ - p.z) / min(r.z, -0.001);
  vec2 flatUv = (p.xy + r.xy * t - uFilmRect.xy) / uFilmRect.zw;
  float phi = atan(r.y, -r.z);
  vec2 domeUv = vec2((p.x - uFilmRect.x) / uFilmRect.z + r.x * 0.7, phi / 3.0);
  vec2 uv = mix(flatUv, domeUv, wrap);
  float seen = mix(step(r.z, -0.001), smoothstep(-0.2, 0.12, phi), wrap);
  vec2 edge = smoothstep(vec2(-0.03), vec2(0.06), uv) * smoothstep(vec2(-0.03), vec2(0.06), 1.0 - uv);
  vec3 c = rlZone(uv.x);
  if (uFilmOn > 0.5) {
    vec2 at = clamp(uv, 0.0, 1.0);
    c = rlToLinear(lod < 0.0 ? texture2D(uFilm, at).rgb : textureLod(uFilm, at, lod).rgb);
  }
  return c * edge.x * edge.y * seen * uFilmGain;
}
`;

interface Patch {
  /** Program cache key: one per kind of surface. */
  key: string;
  uniforms?: Record<string, IUniform>;
  /** Vertex declarations. */
  vertexHead?: string;
  /** Vertex code after the position is known as `transformed`. */
  vertex?: string;
  /** Fragment declarations. */
  head?: string;
  /** Sets `diffuseColor.rgb`. */
  albedo?: string;
  /** Adjusts `roughnessFactor` and `metalnessFactor`. */
  surface?: string;
  /** Adjusts `normal` (view space). */
  normal?: string;
  /** Adds to `totalEmissiveRadiance`. */
  glow?: string;
}

function patched(parameters: MeshPhysicalMaterialParameters, film: FilmUniforms, patch: Patch): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial(parameters);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, film, patch.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRlObj;\nvarying vec3 vRlWorld;\nvarying vec2 vRlUv;\n${patch.vertexHead ?? ''}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRlObj = position;
        vRlUv = uv;
        #ifdef USE_INSTANCING
          vRlObj += vec3(float(gl_InstanceID)) * vec3(17.3, 3.7, 9.1);
        #endif
        ${patch.vertex ?? ''}`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 rlWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rlWorld = instanceMatrix * rlWorld;
        #endif
        vRlWorld = (modelMatrix * rlWorld).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${SHARED}\n${patch.head ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${patch.albedo ?? ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${patch.surface ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${patch.normal ?? ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${patch.glow ?? ''}`);
  };
  material.customProgramCacheKey = () => `rolling-${patch.key}`;
  return material;
}

const WOOD_HEAD = /* glsl */ `
uniform vec3 uWoodA;
uniform vec3 uWoodB;
uniform vec3 uWoodC;
uniform vec4 uWoodP;
uniform vec3 uWoodO;
uniform float uVarnish;
uniform float uWoodLaid;
uniform float uWoodWrap;
// p: pixels, x along the grain. The tree's axis runs along the board but leans through its face,
// so the rings come to the surface as long arches, the way a plain-sawn plank shows them.
vec3 rlWood(vec3 p) {
  // A board laid flat (the floor) shows its figure on top; an upright one on its face.
  p = mix(p, p.xzy, uWoodLaid);
  float bend = rlFbm(vec3(p.x * 0.003, p.y * 0.012, p.z * 0.012)) - 0.5;
  float wobble = rlNoise(vec3(p.x * 0.018, p.y * 0.05, p.z * 0.05)) - 0.5;
  // The axis lies just under the face: the rings above it are nested arches, far longer than they are tall.
  vec2 c = vec2(p.y + 14.0 + bend * 16.0 + wobble * 3.0, p.z - (p.x - 420.0) * 0.06 + bend * 10.0);
  float ring = fract(length(c) * uWoodP.x);
  // Each year ends in a thin dark line of late wood.
  float late = smoothstep(0.45, 0.94, ring) * (1.0 - smoothstep(0.94, 1.0, ring));
  // Nothing is finer than three pixels across the grain: finer detail only shimmers.
  float fibre = rlNoise(vec3(p.x * 0.006, p.y * 0.28, p.z * 0.28)) - 0.5;
  float pore = smoothstep(0.74, 0.97, rlNoise(vec3(p.x * 0.03, p.y * 0.4 + 31.0, p.z * 0.4)));
  vec3 col = mix(uWoodA, uWoodB, clamp(0.4 + bend * 1.2 + fibre * uWoodP.z * 0.5, 0.0, 1.0));
  col = mix(col, uWoodC, clamp(late * 0.6 + pore * uWoodP.y * 0.4, 0.0, 1.0));
  rlH = late * 0.5 - pore * 0.3;
  return col;
}
`;

const METAL_GLOW = /* glsl */ `
{
  vec3 rlR = reflect(uViewDir, rlWorldNormal(normal));
  totalEmissiveRadiance += rlFilm(vRlWorld, rlR, 2.0 + roughnessFactor * 7.0, 1.0) * diffuseColor.rgb * uMetalFilm;
}
`;

const DIE_HEAD = /* glsl */ `
float rlPip(vec2 uv, vec2 at) { return 1.0 - smoothstep(0.1, 0.13, distance(uv, at)); }
// Pips of face n (1 to 6), uv from -0.5 to 0.5.
float rlPips(vec2 uv, int n) {
  float d = 0.27;
  float pips = 0.0;
  if (n == 1 || n == 3 || n == 5) pips += rlPip(uv, vec2(0.0));
  if (n >= 2) pips += rlPip(uv, vec2(-d, d)) + rlPip(uv, vec2(d, -d));
  if (n >= 4) pips += rlPip(uv, vec2(d, d)) + rlPip(uv, vec2(-d, -d));
  if (n == 6) pips += rlPip(uv, vec2(-d, 0.0)) + rlPip(uv, vec2(d, 0.0));
  return min(pips, 1.0);
}
`;

/** Opposite faces of a die add up to seven: +z 1, -z 6, +x 2, -x 5, +y 3, -y 4. */
const DIE_ALBEDO = /* glsl */ `
{
  vec3 rlA = abs(vRlObj);
  float rlPipMask;
  if (rlA.z >= rlA.x && rlA.z >= rlA.y) rlPipMask = rlPips(vRlObj.xy / uDieSize, vRlObj.z > 0.0 ? 1 : 6);
  else if (rlA.x >= rlA.y) rlPipMask = rlPips(vRlObj.yz / uDieSize, vRlObj.x > 0.0 ? 2 : 5);
  else rlPipMask = rlPips(vRlObj.xz / uDieSize, vRlObj.y > 0.0 ? 3 : 4);
  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, rlPipMask);
  rlH = -rlPipMask;
}
`;

export interface Palette {
  wood: Color;
  woodLight: Color;
  woodDeep: Color;
  beam: Color;
  accent: Color;
  /** Light walnut or light maple: tells the two editions apart for the tuning that follows the tone. */
  light: boolean;
}

/** The skin's colours, resolved by the browser: custom properties, `light-dark()` and all. */
export function readPalette(skin: HTMLElement): Palette {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  skin.append(probe);

  const read = (property: string): Color => {
    probe.style.color = `var(${property})`;
    const [r = 0, g = 0, b = 0] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
    const scale = getComputedStyle(probe).color.startsWith('color(') ? 1 : 1 / 255;
    return new Color().setRGB(r * scale, g * scale, b * scale, 'srgb');
  };
  const palette = {
    wood: read('--rl-wood'),
    woodLight: read('--rl-wood-light'),
    woodDeep: read('--rl-wood-deep'),
    beam: read('--rl-beam'),
    accent: read('--rl-accent'),
  };

  probe.remove();
  const hsl = { h: 0, s: 0, l: 0 };
  palette.wood.getHSL(hsl, 'srgb');
  return { ...palette, light: hsl.l > 0.42 };
}

const srgb = (hex: number): Color => new Color().setHex(hex, 'srgb');

type WoodKind = 'deck' | 'floor' | 'lip' | 'beam' | 'dark' | 'drawer' | 'bead';

interface WoodUniforms {
  [name: string]: IUniform;
  uWoodA: IUniform<Color>;
  uWoodB: IUniform<Color>;
  uWoodC: IUniform<Color>;
  uWoodP: IUniform<Vector4>;
  uWoodO: IUniform<Vector3>;
  uVarnish: IUniform<number>;
  uWoodLaid: IUniform<number>;
  uWoodWrap: IUniform<number>;
}

export class Materials {
  readonly film: FilmUniforms;
  readonly #woods: { kind: WoodKind; uniforms: WoodUniforms }[] = [];
  readonly #accented: (IUniform<Color> | Color)[] = [];
  readonly #all: MeshPhysicalMaterial[] = [];
  readonly #metalFilm = { value: 0.38 };
  #palette: Palette;
  #seed = 1;

  readonly brass: MeshPhysicalMaterial;
  /** Brass turned on a lathe: no brushing, a cleaner mirror. */
  readonly brassPolished: MeshPhysicalMaterial;
  /** The same, for a horn or a bowl: seen from the inside too. */
  readonly brassHollow: MeshPhysicalMaterial;
  /** A drum of the counter: dark enamel, with a fine line between one digit and the next. */
  readonly drum: MeshPhysicalMaterial;
  readonly steel: MeshPhysicalMaterial;
  readonly marble: MeshPhysicalMaterial;
  readonly enamel: MeshPhysicalMaterial;
  readonly ivory: MeshPhysicalMaterial;
  readonly die: MeshPhysicalMaterial;
  readonly cork: MeshPhysicalMaterial;
  readonly felt: MeshPhysicalMaterial;
  readonly dark: MeshPhysicalMaterial;
  readonly paper: MeshPhysicalMaterial;
  readonly rope: MeshPhysicalMaterial;
  readonly snake: MeshPhysicalMaterial;
  /** The head and neck: the body's green paint without its diamonds, which do not lie well on a skull. */
  readonly snakeHead: MeshPhysicalMaterial;
  readonly snakeBelly: MeshPhysicalMaterial;
  readonly eye: MeshPhysicalMaterial;
  /** The snake's eyes: amber, wet, and lit a little from within so they catch the light on a dark bench. */
  readonly iris: MeshPhysicalMaterial;
  readonly mouth: MeshPhysicalMaterial;
  readonly tongue: MeshPhysicalMaterial;
  /** Light from inside the shutter box: the film, seen through the slats. */
  readonly leak: MeshPhysicalMaterial;
  /** Where the swallowed marble is along the snake (0 head, 1 tail) and how far it swells the body. */
  readonly bulge = { at: { value: 0 }, size: { value: 0 } };
  /** The colour of the beam, which the marble mirrors from below. */
  readonly bench = { value: new Color() };
  /** Size of the die, for its pips. */
  readonly dieSize = { value: 12 };

  constructor(film: FilmUniforms, palette: Palette) {
    this.film = film;
    this.#palette = palette;
    this.bench.value.copy(palette.beam);
    const metal = { uMetalFilm: this.#metalFilm };
    const accent = { value: palette.accent.clone() };
    const ink = { value: srgb(0x24150a) };
    this.#accented.push(accent);

    this.brass = this.#keep(
      patched({ color: srgb(0xd9ab4c), metalness: 1, roughness: 0.3 }, film, {
        key: 'brass',
        uniforms: metal,
        head: 'uniform float uMetalFilm;',
        // Satin: brushed along the length of the part, too fine to see as lines.
        surface: 'roughnessFactor = clamp(roughnessFactor + (rlNoise(vec3(vRlObj.x * 0.02, vRlObj.y * 0.6, vRlObj.z * 0.6)) - 0.5) * 0.07, 0.06, 1.0);',
        glow: METAL_GLOW,
      })
    );
    this.brassPolished = this.#keep(
      patched({ color: srgb(0xe0b455), metalness: 1, roughness: 0.16 }, film, {
        key: 'metal',
        uniforms: metal,
        head: 'uniform float uMetalFilm;',
        glow: METAL_GLOW,
      })
    );
    this.brassHollow = this.#keep(
      patched({ color: srgb(0xe0b455), metalness: 1, roughness: 0.2, side: DoubleSide }, film, {
        key: 'metal',
        uniforms: metal,
        head: 'uniform float uMetalFilm;',
        glow: METAL_GLOW,
      })
    );
    this.drum = this.#keep(
      patched({ color: srgb(0x1d1611), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }, film, {
        key: 'drum',
        // The drum turns about x: the lines sit half way between two digits and sweep the window on a roll.
        albedo: /* glsl */ `
          float rlTurn = atan(vRlObj.z, vRlObj.y) / 0.6283185;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.68, 0.52), smoothstep(0.035, 0.012, abs(fract(rlTurn) - 0.5)) * 0.55);`,
      })
    );
    this.steel = this.#keep(
      patched({ color: srgb(0xcfd6db), metalness: 1, roughness: 0.14 }, film, {
        key: 'metal',
        uniforms: metal,
        head: 'uniform float uMetalFilm;',
        glow: METAL_GLOW,
      })
    );
    this.marble = this.#keep(
      patched({ color: srgb(0xe9eef2), metalness: 1, roughness: 0.03 }, film, {
        key: 'marble',
        uniforms: { uAccent: accent, uBench: this.bench },
        head: 'uniform vec3 uAccent;\nuniform vec3 uBench;\nfloat rlLine;\nfloat rlEnamel;',
        // Three meridians engraved on the steel and one enamel dot turn with the ball; the reflections stay with the room.
        albedo: /* glsl */ `
          vec3 rlN = normalize(vRlObj);
          float rlRing = length(rlN.xy);
          float rlSeg = abs(fract(atan(rlN.y, rlN.x) / 2.0943951 + 0.5) - 0.5) * 2.0943951;
          rlLine = (1.0 - smoothstep(0.05, 0.085, rlSeg * rlRing)) * smoothstep(0.16, 0.26, rlRing);
          rlEnamel = 1.0 - smoothstep(0.2, 0.235, distance(rlN, normalize(vec3(0.0, 0.66, 0.75))));
          diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - rlLine * 0.8), uAccent, rlEnamel);`,
        surface: /* glsl */ `
          metalnessFactor = mix(metalnessFactor, 0.0, rlEnamel);
          roughnessFactor = mix(roughnessFactor + rlLine * 0.4, 0.3, rlEnamel);`,
        glow: /* glsl */ `
          {
            vec3 rlR = reflect(uViewDir, rlWorldNormal(normal));
            float rlBare = 1.0 - max(rlLine, rlEnamel) * 0.95;
            totalEmissiveRadiance += rlFilm(vRlWorld, rlR, -1.0, 1.0) * 1.2 * rlBare;
            // Below its middle a ball on a beam mirrors the beam.
            totalEmissiveRadiance += uBench * smoothstep(0.05, -0.55, rlR.y) * 0.5 * rlBare;
          }`,
      })
    );
    this.enamel = this.#keep(new MeshPhysicalMaterial({ color: palette.accent.clone(), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }));
    this.#accented.push(this.enamel.color);
    this.ivory = this.#keep(new MeshPhysicalMaterial({ color: srgb(0xf3e7cd), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
    this.die = this.#keep(
      patched({ color: srgb(0xf6ecd4), roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.15 }, film, {
        key: 'die',
        uniforms: { uInk: ink, uDieSize: this.dieSize },
        head: `uniform vec3 uInk;\nuniform float uDieSize;\n${DIE_HEAD}`,
        albedo: DIE_ALBEDO,
        normal: 'normal = rlBump(normal, rlH, 0.5);',
      })
    );
    this.cork = this.#keep(
      patched({ color: srgb(0xcfa672), roughness: 0.92 }, film, {
        key: 'cork',
        albedo: /* glsl */ `
          rlH = rlNoise(vRlObj * 1.1);
          diffuseColor.rgb *= 0.74 + 0.36 * rlH;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.06, 0.02), smoothstep(0.66, 0.8, rlNoise(vRlObj * 2.7 + 9.0)) * 0.75);`,
        normal: 'normal = rlBump(normal, rlH, 0.8);',
      })
    );
    this.felt = this.#keep(
      new MeshPhysicalMaterial({ color: srgb(0x1c1512), roughness: 1, sheen: 1, sheenRoughness: 0.55, sheenColor: srgb(0x6b5a4c) })
    );
    this.dark = this.#keep(new MeshPhysicalMaterial({ color: srgb(0x0d0806), roughness: 0.55 }));
    this.paper = this.#keep(
      patched({ color: srgb(0xf6ead2), roughness: 0.9, side: DoubleSide }, film, {
        key: 'paper',
        // The tape, printed: a few lines of type.
        albedo: /* glsl */ `
          float rlInk = step(0.56, fract(vRlObj.y * 0.3)) * step(abs(vRlObj.x), 8.0) * step(0.3, rlNoise(vec3(vRlObj.x * 0.9, floor(vRlObj.y * 0.3), 3.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.015, 0.008), rlInk * 0.8);`,
      })
    );
    this.rope = this.#keep(
      patched({ color: srgb(0xe6d6b0), roughness: 0.95 }, film, {
        key: 'rope',
        albedo: 'diffuseColor.rgb *= 0.62 + 0.38 * smoothstep(-0.3, 0.3, sin(vRlObj.y * 1.5 + atan(vRlObj.z, vRlObj.x) * 2.0));',
      })
    );
    this.snake = this.#keep(
      patched({ color: srgb(0x1d7a44), roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12 }, film, {
        key: 'snake',
        uniforms: {
          uAccent: accent,
          uBulgeAt: this.bulge.at,
          uBulge: this.bulge.size,
          uSnakeR: this.snakeShape.radius,
          uSnakeL: this.snakeShape.length,
          uMetalFilm: this.#metalFilm,
        },
        vertexHead: 'uniform float uBulgeAt;\nuniform float uBulge;\nuniform float uSnakeR;',
        // The body tapers to the tail, and swells where the marble is on its way down.
        vertex: /* glsl */ `
          // The head covers the open end at uv.x = 0; the tail thins to a point round the ladder.
          float rlTaper = 1.0 - 0.82 * smoothstep(0.8, 1.0, uv.x);
          float rlSwell = uBulge * exp(-pow((uv.x - uBulgeAt) / 0.014, 2.0));
          transformed += normal * (uSnakeR * (rlTaper - 1.0) + rlSwell);`,
        head: 'uniform vec3 uAccent;\nuniform float uMetalFilm;\nuniform float uSnakeR;\nuniform float uSnakeL;',
        // Carved and painted, like the snakes of a wooden games board: one bold diamond down the spine for every
        // three radii, each ringed in black, green flanks, a cream belly, and fine scales cut into the paint.
        albedo: /* glsl */ `
          float rlAlong = vRlUv.x * uSnakeL / (uSnakeR * 3.2);
          // The spine is whatever faces up and out, the belly whatever faces the floor: the tube's own seam is no guide.
          float rlUp = dot(rlWorldNormal(normalize(vNormal)), vec3(0.0, 0.8, 0.6));
          float rlAcross = acos(clamp(rlUp, -1.0, 1.0));
          float rlShape = rlAcross / 1.15 + abs(fract(rlAlong) - 0.5) * 2.0;
          float rlInside = smoothstep(1.0, 0.88, rlShape);
          float rlRim = smoothstep(1.24, 1.06, rlShape) * (1.0 - rlInside);
          vec2 rlCut = vec2(vRlUv.x * uSnakeL / (uSnakeR * 0.62), vRlUv.y * 22.0);
          vec2 rlScale = abs(fract(vec2(rlCut.x + rlCut.y, rlCut.x - rlCut.y) * 0.5) - 0.5);
          float rlSeam = smoothstep(0.0, 0.09, min(rlScale.x, rlScale.y));
          vec3 rlGold = mix(uAccent, vec3(1.0, 0.78, 0.26), 0.65);
          vec3 rlBody = mix(diffuseColor.rgb * (0.85 + 0.15 * cos(rlAcross * 2.0)), rlGold, rlInside);
          rlBody = mix(rlBody, vec3(0.02, 0.025, 0.015), rlRim * 0.9);
          rlBody = mix(vec3(0.9, 0.82, 0.58), rlBody, smoothstep(2.35, 2.0, rlAcross));
          diffuseColor.rgb = rlBody * mix(0.72, 1.0, rlSeam);
          rlH = rlSeam * 0.6 + rlInside * 0.4;`,
        normal: 'normal = rlBump(normal, rlH, 0.5);',
        glow: /* glsl */ `
          {
            vec3 rlR = reflect(uViewDir, rlWorldNormal(nonPerturbedNormal));
            totalEmissiveRadiance += rlFilm(vRlWorld, rlR, 4.0, 1.0) * 0.1 * uMetalFilm;
          }`,
      })
    );
    this.eye = this.#keep(new MeshPhysicalMaterial({ color: srgb(0x100a04), roughness: 0.08, clearcoat: 1 }));
    this.snakeHead = this.#keep(new MeshPhysicalMaterial({ color: srgb(0x1d7a44), roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12 }));
    this.snakeBelly = this.#keep(new MeshPhysicalMaterial({ color: srgb(0xe6d29a), roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.14 }));
    this.iris = this.#keep(
      new MeshPhysicalMaterial({ color: srgb(0xf4b81e), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, emissive: srgb(0x7a4300), emissiveIntensity: 0.7 })
    );
    this.mouth = this.#keep(new MeshPhysicalMaterial({ color: srgb(0x6a1018), roughness: 0.55, side: DoubleSide }));
    this.tongue = this.#keep(new MeshPhysicalMaterial({ color: srgb(0xc8262b), roughness: 0.5, side: DoubleSide }));
    this.leak = this.#keep(
      patched({ color: srgb(0x000000), roughness: 1 }, film, {
        key: 'leak',
        uniforms: { uLeak: this.leakLevel },
        head: 'uniform float uLeak;',
        glow: /* glsl */ `
          {
            float rlU = (vRlWorld.x - uFilmRect.x) / uFilmRect.z;
            vec3 rlC = rlZone(rlU);
            if (uFilmOn > 0.5) rlC = rlToLinear(textureLod(uFilm, vec2(clamp(rlU, 0.0, 1.0), 0.4), 5.0).rgb);
            totalEmissiveRadiance += (rlC + vec3(0.5, 0.3, 0.12)) * uLeak;
          }`,
      })
    );
  }

  /** Brightness of the light behind the shutters. */
  readonly leakLevel = { value: 2.4 };
  /** Radius and length of the snake, for its taper and its scales. */
  readonly snakeShape = { radius: { value: 5 }, length: { value: 900 } };

  /** A board. Every call is a different piece of the tree. */
  wood(kind: WoodKind, bump = 0.5): MeshPhysicalMaterial {
    const seed = this.#seed++;
    const uniforms: WoodUniforms = {
      uWoodA: { value: new Color() },
      uWoodB: { value: new Color() },
      uWoodC: { value: new Color() },
      uWoodP: { value: new Vector4() },
      // Small offsets: the arches of the figure stay on the board.
      uWoodO: { value: new Vector3(((seed * 137.3) % 500) - 250, 20 + ((seed * 53.7) % 41), (seed * 29.1) % 43) },
      uVarnish: { value: 0 },
      uWoodLaid: { value: kind === 'floor' ? 1 : 0 },
      uWoodWrap: { value: kind === 'floor' ? 0 : 1 },
    };
    const material = this.#keep(
      patched({ roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.24 }, this.film, {
        key: 'wood',
        uniforms,
        head: WOOD_HEAD,
        albedo: 'diffuseColor.rgb = rlWood(vRlObj + uWoodO);',
        surface: 'roughnessFactor = clamp(uWoodP.w - rlH * 0.1, 0.2, 1.0);',
        normal: `normal = rlBump(normal, rlH, ${bump.toFixed(2)});`,
        // The varnish mirrors the film: on the floor under the screen it is a true reflection, elsewhere a wash of its colours.
        glow: /* glsl */ `
          {
            vec3 rlFlat = rlWorldNormal(nonPerturbedNormal);
            vec3 rlR = reflect(uViewDir, normalize(mix(rlFlat, rlWorldNormal(normal), 0.4)));
            float rlFresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-uViewDir, rlFlat), 0.0), 5.0);
            // Varnish over wood gives back the picture and its light, with less of its colour than metal does.
            vec3 rlSeen = rlFilm(vRlWorld, rlR, 5.0, uWoodWrap);
            rlSeen = mix(vec3(dot(rlSeen, vec3(0.2126, 0.7152, 0.0722))), rlSeen, 0.6);
            totalEmissiveRadiance += rlSeen * rlFresnel * uVarnish;
          }`,
      })
    );

    this.#woods.push({ kind, uniforms });
    this.#tone(kind, uniforms);
    return material;
  }

  setPalette(palette: Palette): void {
    this.#palette = palette;
    for (const { kind, uniforms } of this.#woods) this.#tone(kind, uniforms);
    this.bench.value.copy(palette.beam);
    for (const accent of this.#accented) ('value' in accent ? accent.value : accent).copy(palette.accent);
  }

  dispose(): void {
    for (const material of this.#all) material.dispose();
  }

  #keep<T extends MeshPhysicalMaterial>(material: T): T {
    this.#all.push(material);
    return material;
  }

  #tone(kind: WoodKind, uniforms: WoodUniforms): void {
    const { wood, woodLight, woodDeep, beam, light } = this.#palette;
    const mix = (a: Color, b: Color, t: number) => a.clone().lerp(b, t);
    // Ring frequency, pores, figure contrast, roughness.
    const grain: Record<WoodKind, [Color, Color, Color, number, number, number, number, number]> = {
      deck: [woodLight, wood, woodDeep, 0.085, light ? 0.18 : 0.5, 0.75, 0.46, 1.1],
      // A darker board under the rail in maple too, so the rail stands out; its varnish mirrors the film softly.
      floor: [light ? mix(wood, woodDeep, 0.5) : wood, mix(wood, woodDeep, light ? 0.85 : 0.6), mix(woodDeep, new Color(0), 0.35), 0.07, light ? 0.2 : 0.55, 0.7, 0.3, 1.6],
      lip: [mix(woodLight, wood, 0.4), mix(wood, woodDeep, 0.3), woodDeep, 0.1, light ? 0.18 : 0.5, 0.7, 0.44, 1.4],
      // Boxwood, as a rule is made of: a close, pale figure that still reads as grain under the burned ticks.
      beam: [mix(beam, new Color(1, 1, 1), 0.14), beam, mix(beam, srgb(0x6b4a1c), 0.64), 0.13, 0.22, 0.88, 0.38, 0.75],
      dark: [mix(wood, woodDeep, 0.5), woodDeep, mix(woodDeep, new Color(0), 0.5), 0.12, 0.4, 0.6, 0.55, 0.8],
      drawer: [mix(woodLight, srgb(0xb9824c), 0.5), mix(wood, srgb(0x8a5a35), 0.5), woodDeep, 0.16, 0.3, 0.9, 0.42, 1.2],
      bead: [mix(beam, new Color(1, 1, 1), 0.25), beam, mix(beam, srgb(0xb9945a), 0.6), 0.2, 0.08, 0.4, 0.36, 0.8],
    };
    const [a, b, c, rings, pores, figure, rough, varnish] = grain[kind];

    uniforms.uWoodA.value.copy(a);
    uniforms.uWoodB.value.copy(b);
    uniforms.uWoodC.value.copy(c);
    uniforms.uWoodP.value.set(rings, pores, figure, rough);
    uniforms.uVarnish.value = varnish;
  }
}
