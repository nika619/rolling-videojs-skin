import '@videojs/html/video/player';
import '@/video/skin';
import template from '@/video/skin.html?raw';
import './site.css';

/** Set once the film is on Mux: the page then streams it from Mux, which also serves the loupe's storyboard. */
const MUX_PLAYBACK_ID = '';
const FILM = './film/kilauea-2026';
// Only a page that streams from Mux pays for Mux's player.
if (MUX_PLAYBACK_ID) await import('@videojs/html/media/mux-video');

const tracks = `<track kind="chapters" srclang="en" label="Episodes" src="${FILM}-chapters.vtt" default>
<track kind="captions" srclang="en" label="English" src="${FILM}-captions.vtt">
<track kind="subtitles" srclang="en" label="Field notes" src="${FILM}-notes.vtt">`;

const media = MUX_PLAYBACK_ID
  ? `<mux-video playback-id="${MUX_PLAYBACK_ID}" playsinline crossorigin preload="metadata">${tracks}</mux-video>`
  : `<video playsinline crossorigin preload="metadata" poster="${FILM}-poster.jpg"><source src="${FILM}.mp4" type="video/mp4">${tracks}
<track kind="metadata" label="thumbnails" src="${FILM}-storyboard.vtt" default></video>`;

const player = document.createElement('video-player');
player.setAttribute('poster', `${FILM}-poster.jpg`);
player.innerHTML = template.replace('<!-- Add a compatible media component here. -->', media);
player.querySelector<HTMLElement>('.media-skin')!.dataset.edition = document.body.dataset.edition ?? 'walnut';

// The skin's film eye writes the frame's colours on the skin; the page borrows the centre one for the glow behind it.
const skin = player.querySelector<HTMLElement>('.media-skin')!;
const stage = document.querySelector<HTMLElement>('.stage')!;
new MutationObserver(() => {
  const centre = skin.style.getPropertyValue('--rl-film-centre');
  if (centre) stage.style.setProperty('--glow', `color-mix(in srgb, ${centre} 34%, transparent)`);
}).observe(skin, { attributes: true, attributeFilter: ['style'] });

const i18n = document.createElement('media-i18n');
i18n.append(player);
document.getElementById('player')!.append(i18n);
