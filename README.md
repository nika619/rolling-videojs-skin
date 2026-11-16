# Rolling

A skin for the [Video.js 10](https://videojs.org) player: a wooden marble machine under the film. The steel marble on the rail is the playhead. Flick it and it rolls on with momentum, tap the rail and it rolls there. Every action has its own mechanism, and under every mechanism is a real, labelled Video.js control with a visible focus ring.

Made for the Video.js Skins Design Challenge 2026.

| Action | Mechanism | Video.js control underneath |
|---|---|---|
| Play, pause | A lever drops the brass pin in front of the marble; on pause it rises and the marble knocks against it | `media-play-button` |
| Seek | Drag or flick the marble, or tap the rail | `media-time-slider` |
| Skip 10 s | Two pinball flippers | `media-seek-button` |
| Time | A brass drum counter; minutes burned into the beam like a ruler | `media-time` |
| Chapters | A tuned chime bar at each chapter, rung as the marble passes | slider chapters |
| Preview | A brass loupe rides the rail | slider thumbnail |
| Mute | A cork in a brass horn | `media-mute-button` |
| Volume | Organ swell shutters; the film's light leaks between the slats | volume slider |
| Speed | A ratchet jack tilts the rail; a die climbs it, six speeds, six faces | `media-playback-rate-button` |
| Captions | Printed on a paper tape under the picture, never over it | `media-captions-button` |
| Picture-in-picture | A brass locket opens on the live film, then leaves | `media-pip-button` |
| Settings | A felt-lined drawer; each setting is a peg in a hole | `media-menu` |
| Full screen | A pull cord | `media-fullscreen-button` |
| End, replay | The marble drops into a bell; a snake carries it home and a ladder lifts it to the start | ended state |
| Error | The marble lies in a tray with "Put it back" | `media-error-dialog` |

## How it is built

- **The flat skin is complete on its own.** CSS and the Video.js 10 HTML elements: walnut and maple editions, six size tiers by the player's own width (container queries), reduced motion, forced colours, more contrast, right-to-left, every language Video.js ships. It is what runs without WebGL, with reduced data, in forced colours and on the smallest players.
- **The 3D machine is drawn over it.** `<rolling-machine>` loads three.js as a lazy chunk only when the player is on screen and WebGL 2 is there. It reads the controls' positions and states from the page and never talks to the player; the controls stay the truth. The film lights it: a 32 × 18 canvas reads the frame's colours each frame. It draws nothing when settled or off screen, and hands back to the flat skin if the GPU context is lost.
- **The marble is real physics.** `<rolling-rail>` drives the time slider: momentum after a flick, a glide to a tapped point, keyboard steps.
- **Sound is synthesized,** with no audio files, only after a first touch, never while the film is muted, with a switch in the drawer.

## Run it

Developed on Node 24.

```sh
npm install
npm run dev:site   # the entry page, http://localhost:5190
npm run dev        # the Video.js workbench: sizes, schemes, languages, right-to-left
```

The film is not in the repository (66 MB). Build it from the U.S. Geological Survey's public-domain footage with `sh film/kilauea/build.sh` (needs ffmpeg and curl; its title cards use Palatino from the Windows fonts folder). Without it the entry page has no film to play; the workbench plays its own stream either way.

```sh
npm test            # unit tests: physics, layout maths, clock
npm run typecheck
npm run test:e2e    # Playwright: Chromium, Firefox, WebKit and a phone profile, then the timed flick tests
npm run build       # dist/ (the entry page) and dist/workbench/
```

## Use it

Copy `src/` into a project that uses `@videojs/html` 10.4, import `src/video/skin.ts`, and use `src/video/skin.html` as the template inside `<video-player>`, with your `<video>` (or `<mux-video>`) where its first comment says. One player per page for now: the template's control ids are fixed. Pick the edition with `data-edition="walnut"` or `"maple"` on the skin, or let the colour scheme pick it. The public Video.js properties work as usual: `--media-accent-color`, `--media-font-family`, `--media-border-radius` and the rest.

## Where things live

- `src/video/`: the skin: `skin.html` (the template), `skin.ts`, `rolling.css`, the caption tape, the sounds and the translated label.
- `src/rail/`: the marble's physics and the ruler.
- `src/machine/`: the 3D machine: when to run it, layout, the film's light, materials, parts, scene.
- `site/`: the entry page.
- `apps/preview/`: the Video.js workbench that previews the skin.
- `film/kilauea/`: how the film is cut.
- `tests/`: unit tests, browser tests and the page they open, and `tools/shot.mjs` for rendering the skin to a picture.

## Credits and licence

Film: footage by the U.S. Geological Survey, Hawaiian Volcano Observatory, public domain. Built on Video.js 10 (Apache-2.0) and three.js (MIT). Started from the Video.js CLI's Scaffold skin.

Rolling is licensed under the [Apache License 2.0](LICENSE).
