import '@videojs/html/video/player';
import '@/video/skin';
import template from '@/video/skin.html?raw';
import './site.css';

/** The film on Mux (public playback ID): the page streams it from Mux, whose element adds the loupe's storyboard by itself. */
const MUX_PLAYBACK_ID = 'TS9zV00Yta00GC9UjUdQBdqIS3W00OOnVIrza3pY9uICPc';
const FILM = './film/kilauea-2026';
// Stream from Mux where the browser can play HLS (natively or through Media Source); elsewhere play the same film as a file.
const probe = document.createElement('video');
const hls =
  !!probe.canPlayType('application/vnd.apple.mpegurl') ||
  !!((window as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? window.MediaSource)?.isTypeSupported?.('video/mp4; codecs="avc1.640028,mp4a.40.2"');
const STREAM = MUX_PLAYBACK_ID && hls;
// Only a page that streams from Mux pays for Mux's player.
if (STREAM) await import('@videojs/html/media/mux-video');

const tracks = `<track kind="chapters" srclang="en" label="Episodes" src="${FILM}-chapters.vtt" default>
<track kind="captions" srclang="en" label="English" src="${FILM}-captions.vtt">
<track kind="subtitles" srclang="en" label="Field notes" src="${FILM}-notes.vtt">`;

const media = STREAM
  ? `<mux-video src="https://stream.mux.com/${MUX_PLAYBACK_ID}.m3u8" playsinline crossorigin preload="metadata" poster="${FILM}-poster.jpg">${tracks}</mux-video>`
  : `<video playsinline crossorigin preload="metadata" poster="${FILM}-poster.jpg"><source src="${FILM}.mp4" type="video/mp4">${tracks}
<track kind="metadata" label="thumbnails" src="${FILM}-storyboard.vtt" default></video>`;

const player = document.createElement('video-player');
player.setAttribute('poster', `${FILM}-poster.jpg`);
player.innerHTML = template.replace('<!-- Add a compatible media component here. -->', media);
const skin = player.querySelector<HTMLElement>('.media-skin')!;
skin.dataset.edition = document.body.dataset.edition ?? 'walnut';

// The skin's film eye writes the frame's colours on the skin; the page borrows the centre one for the light in the room.
const room = document.querySelector<HTMLElement>('.hero-player')!;
new MutationObserver(() => {
  const centre = skin.style.getPropertyValue('--rl-film-centre');
  if (centre) room.style.setProperty('--glow', `color-mix(in srgb, ${centre} 38%, transparent)`);
}).observe(skin, { attributes: true, attributeFilter: ['style'] });

const i18n = document.createElement('media-i18n');
i18n.append(player);
document.getElementById('player')!.append(i18n);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const video = (): HTMLVideoElement | null => player.querySelector('video');
const key = (id: string): void => player.querySelector<HTMLElement>(`#${id}`)?.click();

/** Bring the player into view before a page button works it, so the mechanism is seen. */
function bring(): void {
  const r = player.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) player.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
}

/** Throw the marble along the rail the way a hand would: grab it, move fast, let go. */
function flick(): void {
  const slider = player.querySelector<HTMLElement>('media-time-slider');
  const v = video();
  if (!slider || !v || !(v.duration > 0)) return;
  const r = slider.getBoundingClientRect();
  const from = r.left + (v.currentTime / v.duration) * r.width;
  const dir = v.currentTime / v.duration > 0.6 ? -1 : 1;
  const y = r.top + r.height / 2;
  const at = (x: number, type: string, target: EventTarget): boolean =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  at(from, 'pointerdown', slider);
  let i = 0;
  const step = (): void => {
    i += 1;
    at(from + dir * i * r.width * 0.022, 'pointermove', slider);
    if (i < 8) requestAnimationFrame(step);
    else at(from + dir * i * r.width * 0.022, 'pointerup', slider);
  };
  requestAnimationFrame(step);
}

const acts: Record<string, () => void> = {
  play: () => key('rl-play'),
  flick,
  cork: () => key('rl-mute'),
  die: () => key('rl-rate'),
  tape: () => key('rl-cc'),
  drawer: () => key('rl-settings'),
  bell: () => {
    const v = video();
    if (!v || !(v.duration > 0)) return;
    if (v.ended) return key('rl-play');
    v.currentTime = Math.max(0, v.duration - 3.5);
    if (v.paused) key('rl-play');
  },
};

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-act]');
  const act = button && acts[button.dataset.act!];
  if (!act) return;
  if (button.dataset.act !== 'play') bring();
  // Let a smooth scroll land before the mechanism moves, so the eye sees it.
  setTimeout(act, button.dataset.act === 'play' || reduced.matches ? 0 : 350);
});

// The bar's action says what it will do next.
const action = document.querySelector<HTMLButtonElement>('.act[data-act="play"]')!;
const label = (): void => {
  const v = video();
  action.textContent = v && !v.paused && !v.ended ? 'Pause the film' : v?.ended ? 'Play it again' : 'Play the film';
};
for (const type of ['play', 'pause', 'ended']) player.addEventListener(type, label, true);

// Scroll scenes: laid out now, so nothing jumps; animated once the machine has mounted, so they never compete with it.
if (!reduced.matches) {
  for (const section of document.querySelectorAll<HTMLElement>('.plan, .snakes')) section.classList.add('is-scene');
  document.querySelector('.snakes .frames li')?.classList.add('is-on');
  let started = false;
  const go = (): void => {
    if (started) return;
    started = true;
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
    idle(() =>
      import('./story').then(
        (story) => story.start(),
        () => document.querySelectorAll('.is-scene').forEach((s) => s.classList.remove('is-scene')),
      ),
    );
  };
  new MutationObserver(() => skin.dataset.machine === '3d' && go()).observe(skin, { attributes: true, attributeFilter: ['data-machine'] });
  setTimeout(go, 4500);
  // Someone who scrolls before the machine mounts should not find a still scene.
  addEventListener('scroll', () => scrollY > innerHeight * 0.5 && go(), { passive: true });
}
