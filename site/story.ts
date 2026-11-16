// The page's scroll story, loaded after the player's machine has mounted and only when motion is allowed.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const NS = 'http://www.w3.org/2000/svg';
const ART = { w: 3300, h: 546 };

export function start(): void {
  plan();
  snakes();
  rise();
  ScrollTrigger.refresh();
}

/** The plan: the camera travels the dock part by part; each part lights from line drawing to wood as it is named. */
function plan(): void {
  const section = document.querySelector<HTMLElement>('.plan.is-scene');
  if (!section) return;
  const stage = section.querySelector<HTMLElement>('.plan-stage')!;
  const view = section.querySelector<HTMLElement>('.plan-view')!;
  const art = section.querySelector<HTMLElement>('.plan-art')!;
  const mask = section.querySelector('mask')!;
  const all = section.querySelector('.lit-all')!;
  const line = section.querySelector('.leader polyline')!;
  const dot = section.querySelector('.leader circle')!;
  const parts = [...section.querySelectorAll<HTMLLIElement>('.parts li')].map((li) => {
    const x = (Number(li.dataset.x) / 100) * ART.w;
    const y = (Number(li.dataset.y) / 100) * ART.h;
    const spot = document.createElementNS(NS, 'circle');
    spot.setAttribute('cx', String(x));
    spot.setAttribute('cy', String(y));
    spot.setAttribute('r', '0');
    spot.setAttribute('fill', 'url(#spot)');
    mask.append(spot);
    return { li, x, y, r: Number(li.dataset.r) * 1.35, spot };
  });
  section.style.setProperty('--steps', String(parts.length + 1));
  art.style.cssText = 'position:absolute;inset:0 auto auto 0;inline-size:100%';

  const width = (): number => view.clientWidth;
  const height = (): number => (width() * ART.h) / ART.w;
  const zoom = (): number => Math.min(6, Math.max(2.2, (view.clientHeight * 0.72) / height()));
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  // Where the art sits to put point (x, y) at the middle of the view, without showing past its ends.
  const shot = (p?: { x: number; y: number }): gsap.TweenVars => ({
    scale: () => (p ? zoom() : 1),
    x: () => (p ? clamp(width() / 2 - (zoom() * p.x * width()) / ART.w, width() - zoom() * width(), 0) : 0),
    y: () => {
      const s = p ? zoom() : 1;
      const h = s * height();
      const vh = view.clientHeight;
      if (!p || h <= vh) return (vh - h) / 2;
      return clamp(vh / 2 - (s * p.y * height()) / ART.h, vh - h, 0);
    },
  });

  gsap.set(all, { opacity: 0 });
  gsap.set(art, shot());
  gsap.set(parts.map((p) => p.li), { autoAlpha: 0, y: 16 });

  const leader = (): void => {
    let best = parts[0]!;
    let alpha = 0;
    for (const p of parts) {
      const a = Number(gsap.getProperty(p.li, 'opacity'));
      if (a > alpha) [best, alpha] = [p, a];
    }
    const s = Number(gsap.getProperty(art, 'scale'));
    const box = stage.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const px = v.left - box.left + Number(gsap.getProperty(art, 'x')) + (s * best.x * width()) / ART.w;
    const py = v.top - box.top + Number(gsap.getProperty(art, 'y')) + (s * best.y * height()) / ART.h;
    const h3 = best.li.querySelector('h3')!.getBoundingClientRect();
    const lx = h3.left - box.left + 6;
    const ly = h3.top - box.top - 14;
    const knee = Math.min(ly - 12, Math.max(py + 28, v.bottom - box.top + 8));
    line.setAttribute('points', `${lx},${ly} ${px},${knee} ${px},${py + 9}`);
    dot.setAttribute('cx', String(px));
    dot.setAttribute('cy', String(py));
    (line.parentNode as SVGElement).style.opacity = String(alpha);
  };

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    onUpdate: leader,
    scrollTrigger: { trigger: section.querySelector('.plan-track'), start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true },
  });
  tl.to({}, { duration: 0.4 });
  for (const p of parts) {
    tl.to(art, { ...shot(p), duration: 1 });
    tl.to(p.spot, { attr: { r: p.r }, duration: 0.7, ease: 'power2.out' }, '<0.45');
    tl.to(p.li, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, '<0.1');
    tl.to({}, { duration: 0.7 });
    tl.to(p.li, { autoAlpha: 0, y: -12, duration: 0.3, ease: 'power1.in' });
  }
  tl.to(art, { ...shot(), duration: 1 });
  tl.to(all, { opacity: 1, duration: 0.6 }, '<0.3');
  tl.to({}, { duration: 0.5 });
}

/** Snakes and ladders: the replay, one frame per stretch of scroll. */
function snakes(): void {
  const section = document.querySelector<HTMLElement>('.snakes.is-scene');
  if (!section) return;
  const frames = [...section.querySelectorAll<HTMLLIElement>('.frames li')];
  let shown = 0;
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: ({ progress }) => {
      const i = Math.min(frames.length - 1, Math.floor(progress * frames.length));
      if (i === shown) return;
      frames[shown]!.classList.remove('is-on');
      frames[i]!.classList.add('is-on');
      shown = i;
    },
  });
}

/** Each section's parts rise in turn as it arrives: heading, then text, then pictures. Only what starts below the fold. */
function rise(): void {
  const targets = [
    ...document.querySelectorAll<HTMLElement>(
      '.answers > h2, .answers-intro, .exchange > *, .sound p, .snakes-text p, .film-facts > div, .built li',
    ),
  ].filter((el) => el.getBoundingClientRect().top > innerHeight);
  gsap.set(targets, { autoAlpha: 0, y: 24 });
  ScrollTrigger.batch(targets, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.07, overwrite: true }),
  });
}
