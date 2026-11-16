// The page's scroll story, loaded after the player's machine has mounted and only when motion is allowed.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

const NS = 'http://www.w3.org/2000/svg';
const ART = { w: 3300, h: 546 };

export function start(): void {
  plan();
  snakes();
  words();
  pictures();
  film();
  counts();
  rail();
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

/** Only what starts below the fold moves; what the visitor already sees stays put. */
const below = (el: Element): boolean => el.getBoundingClientRect().top > innerHeight;

/** Headings arrive line by line, each line rising out of its own mask. */
function words(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.answers h2, .brief h2, .brief h3, .film-frame h2, .built h2, .last h2')) {
    if (!below(el)) continue;
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, { yPercent: 115, duration: 1, ease: 'expo.out', stagger: 0.09, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
    });
  }
}

/** Pictures open left to right, the way the playhead crosses the rail, settling out of a slight push-in. */
function pictures(): void {
  for (const box of document.querySelectorAll<HTMLElement>('.response, .brief-fig')) {
    if (!below(box)) continue;
    const tl = gsap.timeline({
      scrollTrigger: { trigger: box, start: 'top 82%', once: true },
      onComplete: () => gsap.set(box, { clearProps: 'clipPath' }),
    });
    tl.fromTo(box, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut' });
    tl.from(box.querySelector('img'), { scale: 1.18, duration: 1.7, ease: 'expo.out' }, 0);
  }
}

/** The film's frame opens like an iris as it rises: from a framed print to the whole screen. */
function film(): void {
  const frame = document.querySelector<HTMLElement>('.film-frame');
  if (!frame || !below(frame)) return;
  const tl = gsap.timeline({ scrollTrigger: { trigger: frame, start: 'top bottom', end: 'top 10%', scrub: 0.5 } });
  tl.fromTo(frame, { clipPath: 'inset(14% 18% 14% 18% round 28px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none' });
  tl.fromTo(frame.querySelector('img'), { scale: 1.3 }, { scale: 1, ease: 'none' }, 0);
}

/** Figures count up from nothing as they arrive; the text is only changed once it is on screen. */
function counts(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.film-frame .figure, .film-facts dt')) {
    const match = /^(\d+)(.*)$/s.exec(el.textContent ?? '');
    if (!match || !below(el)) continue;
    const [, to, rest] = match;
    const n = { v: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => gsap.to(n, { v: Number(to), duration: 1.6, ease: 'power3.out', onUpdate: () => void (el.textContent = `${Math.round(n.v)}${rest}`) }),
    });
  }
}

/** The page has a playhead too: a steel marble rolls along a brass rail at the foot of the screen as you read. */
function rail(): void {
  const rail = document.querySelector<HTMLElement>('.page-rail');
  const marble = rail?.querySelector<HTMLElement>('span');
  if (!rail || !marble) return;
  rail.hidden = false;
  const run = (): number => rail.clientWidth - marble.offsetWidth;
  gsap.to(marble, {
    x: run,
    rotation: () => (run() / (Math.PI * marble.offsetWidth)) * 360,
    ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: 0.4, invalidateOnRefresh: true },
  });
}

/** Each section's parts rise in turn as it arrives: text, then pictures. Only what starts below the fold. */
function rise(): void {
  const targets = [
    ...document.querySelectorAll<HTMLElement>('.answers-intro, .exchange > :not(figure), .sound p, .snakes-text p, .film-facts > div, .built li, .last p, .last pre'),
  ].filter(below);
  gsap.set(targets, { autoAlpha: 0, y: 24 });
  ScrollTrigger.batch(targets, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.07, overwrite: true }),
  });
}
