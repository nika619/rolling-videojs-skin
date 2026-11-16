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

/** The plan: the playhead sweeps the dock in, then a brass loupe travels it part by part while the room dims around it. */
function plan(): void {
  const section = document.querySelector<HTMLElement>('.plan.is-scene');
  if (!section) return;
  const view = section.querySelector<HTMLElement>('.plan-view')!;
  const art = section.querySelector<HTMLElement>('.plan-art')!;
  const lens = [section.querySelector('.spot')!, section.querySelector('.loupe')!];
  const shade = section.querySelector('.plan-shade')!;
  const reveal = section.querySelector('.reveal')!;
  const edge = section.querySelector('.plan-edge')!;
  // The camera needs the full-size picture; it loads now, after the machine has mounted.
  for (const image of section.querySelectorAll('.plan-dock')) image.setAttribute('href', './img/dock-6600.webp');
  const parts = [...section.querySelectorAll<HTMLLIElement>('.parts li')].map((li) => ({
    li,
    x: (Number(li.dataset.x) / 100) * ART.w,
    y: (Number(li.dataset.y) / 100) * ART.h,
    r: Number(li.dataset.r) * 1.1,
  }));
  section.style.setProperty('--steps', String(parts.length + 1));
  art.style.cssText = 'position:absolute;inset:0 auto auto 0;inline-size:100%';

  const width = (): number => view.clientWidth;
  const height = (): number => (width() * ART.h) / ART.w;
  // Each part fills most of the view's height inside its loupe, but never closer than the picture's
  // 6600 px of detail allow at this screen's density.
  const zoom = (p: { r: number }): number => {
    const most = Math.min(6, 7200 / (width() * (window.devicePixelRatio || 1)));
    return Math.min(most, (view.clientHeight * 0.84) / ((2 * p.r * height()) / ART.h));
  };
  // Where the art sits to put the part at the middle of the view; past the dock's ends the page shows.
  const shot = (p?: { x: number; y: number; r: number }): gsap.TweenVars => ({
    scale: () => (p ? zoom(p) : 1),
    x: () => (p ? width() / 2 - (zoom(p) * p.x * width()) / ART.w : 0),
    y: () => (p ? view.clientHeight / 2 - (zoom(p) * p.y * height()) / ART.h : (view.clientHeight - height()) / 2),
  });

  gsap.set(art, shot());
  gsap.set(reveal, { attr: { width: 0 } });
  gsap.set(edge, { attr: { x: 0 }, opacity: 0.85 });
  gsap.set(lens, { attr: { cx: parts[0]!.x, cy: parts[0]!.y, r: 0 } });
  gsap.set(parts.map((p) => p.li), { autoAlpha: 0, y: 16 });

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: section.querySelector('.plan-track'), start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true },
  });
  // The playhead crosses the dock and the machine appears behind it.
  tl.to(reveal, { attr: { width: ART.w }, duration: 1.4, ease: 'none' });
  tl.to(edge, { attr: { x: ART.w - 5 }, duration: 1.4, ease: 'none' }, 0);
  tl.to(edge, { opacity: 0, duration: 0.2 }, 1.3);
  for (const [i, p] of parts.entries()) {
    const t = tl.duration();
    tl.to(art, { ...shot(p), duration: 1 }, t);
    tl.to(lens, { attr: { cx: p.x, cy: p.y, r: p.r }, duration: 1 }, t);
    if (i === 0) tl.to(shade, { opacity: 0.62, duration: 0.6 }, t + 0.2);
    tl.to(p.li, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, t + 0.55);
    tl.to(p.li, { autoAlpha: 0, y: -12, duration: 0.3, ease: 'power1.in' }, t + 1.6);
  }
  const end = tl.duration();
  tl.to(art, { ...shot(), duration: 1 }, end);
  tl.to(lens, { attr: { r: 0 }, duration: 0.6 }, end);
  tl.to(shade, { opacity: 0, duration: 0.6 }, end + 0.3);
  tl.to({}, { duration: 0.5 });
}

/** Snakes and ladders: the replay, filmed one 60 fps tick at a time, played by the scroll. */
function snakes(): void {
  const section = document.querySelector<HTMLElement>('.snakes.is-scene');
  if (!section) return;
  const reel = section.querySelector<HTMLImageElement>('.reel')!;
  const urls = Array.from({ length: 62 }, (_, i) => `./img/snake/seq/${String(i).padStart(2, '0')}.webp`);
  // Fetched and decoded as the scene nears, so a scroll step only swaps a ready picture.
  const ready: HTMLImageElement[] = [];
  ScrollTrigger.create({
    trigger: section,
    start: 'top 300%',
    once: true,
    onEnter: () => {
      for (const url of urls) {
        const image = new Image();
        image.src = url;
        image.decode().catch(() => {});
        ready.push(image);
      }
    },
  });
  let shown = 0;
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: ({ progress }) => {
      const i = Math.min(urls.length - 1, Math.floor(progress * urls.length));
      if (i !== shown) reel.src = urls[(shown = i)]!;
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
