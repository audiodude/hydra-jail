# hydra-jail

A single-page workspace for [Hydra](https://hydra.ojack.xyz) sketches: a fixed 1920×1080 canvas with a CodeMirror editor (blackboard theme, Ubuntu Mono) below.

Open `index.html` in a browser (or serve the directory, e.g. `python3 -m http.server`).

- **Ctrl+Shift+Enter** (Cmd+Shift+Enter on macOS) or **Run**: evaluate the editor contents.
- **1:1 / fit**: show the canvas at real pixel size or scaled to the window. It always renders at 1920×1080 either way.
- The working buffer autosaves to `localStorage` as you type, and reloads with the page.
- If a run hangs or crashes the page, the next load skips the auto-run so you can fix the code.
- Mic input (`a.fft`) is off (`detectAudio: false`), so there's no permission prompt.
- **⏺ Rec** (live): record the canvas in real time to `<sketch>-<timestamp>.webm` via `MediaRecorder`. Quick, but frames can be dropped or unevenly timed if the encoder falls behind.
- **⏵ Render N s** (frame-exact, max 300 s): pauses the live loop and steps Hydra's `time` by exactly 1/60 s per frame, redrawing any p5 instances first, then encodes every frame with WebCodecs into a constant-60fps `.mp4` (H.264, or VP9 if H.264 encoding isn't available). A sketch that sets Hydra's `fps` lower renders as it looks live, each drawn frame held until the next. The whole file is built in memory, hence the 5-minute cap. May run slower than real time; click again to cancel. Only animation driven by Hydra's `time` (or p5's `frameCount`) stays in sync. `Date.now()`, `performance.now()` and `s.millis()` follow the wall clock and will drift.

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
