# hydra-jail

A single-page workspace for [Hydra](https://hydra.ojack.xyz) sketches: a fixed 1920×1080 canvas with a CodeMirror editor (blackboard theme, Ubuntu Mono) below.

The app builds to a single self-contained file, `dist/index.html` (about 1.5 MB, every library and font inlined, no network requests). Download it from a [release](https://github.com/audiodude/hydra-jail/releases) and open it directly, or serve it. To build it yourself, see [Development](#development).

- **Ctrl+Shift+Enter** (Cmd+Shift+Enter on macOS) or **Run**: evaluate the editor contents.
- **1:1 / fit**: show the canvas at real pixel size or scaled to the window. It always draws at 1920×1080 either way (except during a 4K render).
- The working buffer autosaves to `localStorage` as you type, and reloads with the page.
- If a run hangs or crashes the page, the next load skips the auto-run so you can fix the code.
- Mic input (`a.fft`) is off (`detectAudio: false`), so there's no permission prompt.
- **⏵ Render N s** (frame-exact): asks where to save the `.mp4`, then pauses the live loop and steps Hydra's `time` by exactly 1/60 s per frame, redrawing any p5 instances first, and encodes every frame with WebCodecs (muxed by [Mediabunny](https://mediabunny.dev)) into a constant-60fps `.mp4`. A sketch that sets Hydra's `fps` lower renders as it looks live, each drawn frame held until the next. May run slower than real time; click again to cancel. Only animation driven by Hydra's `time` (or p5's `frameCount`) stays in sync. `Date.now()`, `performance.now()` and `s.millis()` follow the wall clock and will drift.
  - The video is written to disk as it renders, so memory use doesn't grow with length and there's no length cap. This needs Chrome or Edge (the File System Access API). A cancelled or failed render leaves no file behind, and leaves an existing file you chose to overwrite untouched.
  - The size menu picks **1080p** or **4K** (3840×2160). 4K takes about 4× as long; for YouTube it's worth it, since YouTube gives 4K uploads a higher bitrate. 4K is greyed out if the browser can't encode it at the chosen format (or its WebGL can't draw that large). Hydra draws at 4K for the render, which resizes its buffers, so feedback (`src(o0)`) restarts from black when a 4K render starts and again when it ends.
  - The format menu picks **8-bit H.264** (default; VP9 if H.264 encoding isn't available), which plays everywhere, or **10-bit VP9**, which keeps smooth gradients (dark blues especially) from banding, on YouTube too, but won't play in QuickTime, Safari or iOS.
  - Both menus remember their choice.
  - Frames are converted to video colour on the GPU as standard limited-range BT.709, so players that ignore the full-range flag (like VLC) show the same colours as the canvas instead of crushing the darks.

## p5.js

p5.js 1.11 is loaded globally (instance mode). Draw into a hidden p5 canvas and feed it to Hydra:

```js
if (window.p) p.remove(); // re-running otherwise stacks up p5 instances
p = new p5(s => {
  s.setup = () => { s.pixelDensity(1); s.createCanvas(1920, 1080).hide(); };
  s.draw = () => { s.background(0); s.circle(s.width / 2, s.height / 2, 400); };
});
s0.init({ src: p.canvas });
src(s0).modulate(osc(3), 0.1).out()
```

## Sketches

A VSCode-style explorer sits left of the editor; sketches are stored in `localStorage`.

| Action | How |
| --- | --- |
| Toggle explorer | **Ctrl+B** or the file icon |
| Save | **Ctrl+S** (prompts for a name if untitled) |
| Save as | **Ctrl+Shift+S** |
| New | **+** in the explorer header |
| Open | click a sketch |
| Rename | double-click, or hover → ✎ |
| Delete | hover → × |
| Revert to saved | hover the modified sketch → ↺ |

A ● marks unsaved changes (for untitled, anything other than the starter code); switching sketches with unsaved changes asks first.

Sketches are shared between open tabs: a save in one shows up in the others, and a sketch deleted elsewhere becomes untitled in tabs that had it open. If the stored sketches can't be parsed, they're moved aside to a `hydra-jail:sketches:corrupt-<timestamp>` key rather than overwritten.

## Development

All source lives in `src/`, including `src/index.html` (the markup and Vite's entry point; it doesn't work opened directly). Libraries come from npm and [Vite](https://vite.dev) bundles everything into `dist/index.html` with `vite-plugin-singlefile`.

| File | Contents |
| --- | --- |
| `src/main.js` | entry point: button wiring, startup and auto-run |
| `src/hydra.js` | Hydra, the frame loop, p5 instance tracking, runtime error capture |
| `src/workspace.js` | the editor, the open sketch, running code, buffer autosave |
| `src/explorer.js` | the sketch explorer and its shortcuts |
| `src/storage.js` | the `localStorage` layout and safe read/write helpers |
| `src/render.js` | ⏵ Render |
| `src/yuv.js` | GPU conversion of rendered frames to video colour |
| `src/status.js`, `src/style.css` | status bar, styles and bundled fonts |

```sh
npm install
npm run dev               # dev server with live reload
npm run build             # dist/index.html
npm test                  # build, then Playwright against the installed Google Chrome
npm test -- -g render     # a subset
```

Tests run against the built `dist/index.html`, including opened from `file://`. They use installed Chrome (`channel: 'chrome'`) because Playwright's bundled Chromium usually can't encode H.264. Any request the app makes outside itself fails the test, which keeps the build self-contained.

Deploy or release `dist/` only, never the repo root.
