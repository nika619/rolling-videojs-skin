/**
 * Extras for the high tier: ambient occlusion, so parts sit on the bench instead of floating over it,
 * and a gentle tilt-shift that softens the near and far edges like a close-up of a small machine.
 */
import { type Camera, HalfFloatType, type Scene, Vector2, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface Post {
  render(scene: Scene, camera: Camera): void;
  setSize(width: number, height: number, ratio: number): void;
  dispose(): void;
}

const TiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new Vector2(1, 1) },
    /** Rows (0 at the bottom, 1 at the top) between which the picture stays sharp. */
    uSharp: { value: new Vector2(0.07, 1.01) },
    /** Largest blur radius, in device pixels. */
    uRadius: { value: 1.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform vec2 uSharp;
    uniform float uRadius;
    varying vec2 vUv;
    void main() {
      float away = max(smoothstep(uSharp.x, 0.0, vUv.y), smoothstep(uSharp.y, 1.0, vUv.y));
      vec2 reach = uTexel * uRadius * away;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2;
      // Eight taps on a ring, four on a smaller one.
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * reach) * 0.07;
      }
      for (int i = 0; i < 4; i++) {
        float a = float(i) * 1.5707963 + 0.4;
        sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * reach * 0.5) * 0.06;
      }
      gl_FragColor = sum;
    }`,
};

export function createPost(renderer: WebGLRenderer, scene: Scene, camera: Camera): Post {
  const target = new WebGLRenderTarget(2, 2, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const occlusion = new GTAOPass(scene, camera, 2, 2);
  const tilt = new ShaderPass(TiltShift);

  // World units are pixels: shade the corners within about a key's thickness.
  occlusion.updateGtaoMaterial({ radius: 18, distanceExponent: 1.3, thickness: 4, scale: 1.5, samples: 14, screenSpaceRadius: false });
  occlusion.blendIntensity = 1;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(occlusion);
  composer.addPass(tilt);
  composer.addPass(new OutputPass());

  return {
    render() {
      composer.render();
    },
    setSize(width, height, ratio) {
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      tilt.uniforms.uTexel!.value.set(1 / (width * ratio), 1 / (height * ratio));
    },
    dispose() {
      composer.dispose();
      target.dispose();
      occlusion.dispose();
    },
  };
}
