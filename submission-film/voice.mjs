// Voiceover: one ElevenLabs take of the whole script, cut at its pauses and laid line by line on the shot each
// line names, then muxed into the film with the picture copied untouched.
// node submission-film/voice.mjs <take.mp3>   -> docs/renders/film/rolling-film.mp4 (voiced), rolling-film-silent.mp4 kept
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const take = process.argv[2];
const dir = fileURLToPath(new URL('../docs/renders/film/', import.meta.url));
const silent = `${dir}rolling-film-silent.mp4`;
if (!existsSync(silent)) copyFileSync(`${dir}rolling-film.mp4`, silent);

// [where the line is in the take (s), where it lands in the film (s)]. Take times from silencedetect -40 dB / 0.25 s;
// film times are each scene's start + 0.1 to 0.2 s, as the type arrives (film.js scene table).
const LINES = [
  [0.0, 3.49, 0.4], [3.96, 7.96, 4.5], [8.45, 10.35, 8.9], [10.79, 12.58, 11.1], [13.03, 14.3, 13.3], [14.75, 16.19, 15.5],
  [16.66, 18.29, 17.7], [18.76, 20.22, 19.9], [20.68, 22.1, 22.1], [22.55, 24.0, 24.3], [24.48, 26.24, 26.5], [26.72, 28.7, 28.7],
  [29.17, 31.02, 30.9], [31.47, 33.3, 33.1], [33.75, 35.46, 35.3], [35.95, 38.59, 37.6], [39.05, 42.03, 41.0], [42.36, 45.09, 44.2],
  [45.58, 48.88, 48.8], [49.31, 52.02, 52.2], [52.46, 54.26, 55.8], [54.68, 57.06, 58.7], [57.48, 61.22, 62.1], [61.67, 65.88, 65.9],
];
for (let i = 1; i < LINES.length; i++) {
  const [a, b, at] = LINES[i - 1];
  if (at + (b - a) > LINES[i][2]) throw new Error(`line ${i} overruns line ${i + 1}`);
}

const parts = LINES.map(([a, b, at], i) => {
  const from = Math.max(0, a - 0.04), to = b + 0.12, ms = Math.round((at - (a - from)) * 1000);
  return `[0:a]atrim=${from}:${to},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${(to - from - 0.08).toFixed(3)}:d=0.08,adelay=${ms}|${ms}[l${i}]`;
});
const graph = `${parts.join(';')};${LINES.map((_, i) => `[l${i}]`).join('')}amix=inputs=${LINES.length}:normalize=0,apad,atrim=0:70.3,loudnorm=I=-16:TP=-1.5:LRA=7[vo]`;
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', take, '-filter_complex', graph, '-map', '[vo]', '-ar', '48000', `${dir}voice.wav`], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', `${dir}voice.wav`, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', `${dir}rolling-film.mp4`], { stdio: 'inherit' });
console.log('->', `${dir}rolling-film.mp4`);
