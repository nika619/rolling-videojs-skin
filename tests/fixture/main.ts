import '@videojs/html/video/player';
import '@/video/skin';
import template from '@/video/skin.html?raw';

/**
 * The page the browser tests drive: the skin on a plain <video> with local media, so no test depends on a network.
 * Options in the query string: width (px), edition (walnut|maple), scheme (light|dark), dir (rtl), muted,
 * src (broken: a film that fails to load; lava: a warm moving picture for looking at the film's light;
 * any other name plays /<name>.mp4 from public/),
 * machine (flat|standard|high: the 3D machine's quality; left out, the machine decides for itself).
 */
const params = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
const i18n = document.createElement('media-i18n');
const player = document.createElement('video-player');
const broken = params.get('src') === 'broken';
// MP4 first: WebKit on Windows stalls on WebM instead of falling through to the next source.
const sources = broken
  ? ''
  : params.has('src')
    ? `<source src="/${params.get('src')}.mp4" type="video/mp4">`
    : '<source src="/clip.mp4" type="video/mp4"><source src="/clip.webm" type="video/webm">';

player.innerHTML = template.replace(
  '<!-- Add a compatible media component here. -->',
  `<video playsinline preload="auto"${broken ? ' src="/missing.mp4"' : ''}${params.has('muted') ? ' muted' : ''}>${sources}<track kind="chapters" srclang="en" src="/chapters.vtt" default><track kind="captions" label="English" srclang="en" src="/captions.vtt"></video>`
);

const skin = player.querySelector<HTMLElement>('.media-skin')!;
if (params.has('edition')) skin.dataset.edition = params.get('edition')!;
if (params.has('machine')) player.querySelector('rolling-machine')!.setAttribute('quality', params.get('machine')!);
if (params.has('scheme')) document.documentElement.style.colorScheme = params.get('scheme')!;
if (params.has('dir')) document.documentElement.dir = params.get('dir')!;

root.style.inlineSize = `${params.get('width') ?? '960'}px`;
root.style.maxInlineSize = '100%';
i18n.append(player);
root.append(i18n);
