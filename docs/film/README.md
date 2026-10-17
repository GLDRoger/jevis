# Launch film

`film.html` draws every frame of the Jevis launch film on a canvas, in plain JavaScript. `draw(f)` depends only on the frame number. The picture and the sound share one beat grid: the music runs at 124 BPM, and its first drop kick lands at 11.644 s.

```sh
npm ci                                   # playwright-core, already a Jevis dependency
node docs/film/render.mjs --grid 36      # contact sheet -> docs/film/out/grid.png
node docs/film/render.mjs --only 361,840 # full-size frames
node docs/film/render.mjs --audio        # the mix only -> out/mix.wav, out/spectrum.png
node docs/film/render.mjs                # the film -> out/jevis-launch.mp4
```

The renderer needs Node 22+, ffmpeg, and Chromium or Chrome (`CHROME=/path/to/chrome` overrides the search). The film reads the lesson titles from `wiki/` when it renders, so the lesson wall and its count always match the repository. Open `film.html` in a browser and click to watch it silently, or add `?f=840` to see one frame.

## Sound

Nothing in the soundtrack is synthesized. `render.mjs` downloads the files into `docs/film/.audio/`, which is not committed: their licenses allow use inside a video but not redistribution as standalone audio.

- **Music:** "Take this Higher" by Michael Ramir C., from [Mixkit](https://mixkit.co/free-stock-music/), under the [Mixkit Stock Music Free License](https://mixkit.co/license/#musicFree). The film plays the track to bar 29, then jumps on a downbeat to the track's own outro.
- **Sound effects:** 14 files from [Mixkit's free sound effects](https://mixkit.co/free-sound-effects/), under the [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree). `audio.mjs` lists each one with its Mixkit id.

The mix ducks the music a few dB under each sound effect, then normalizes to about -16 LUFS with true peaks under -4 dBFS.

`STEM=music` or `STEM=sfx` with `--audio --out <dir>` writes one bus alone, so you can check each effect sits above the music.
