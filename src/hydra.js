// Hydra, the frame loop, p5 tracking and runtime error capture.
// Hydra's package entry is its raw Browserify source; the prebuilt dist file is the same code the CDN served.
import Hydra from 'hydra-synth/dist/hydra-synth.js';
import P5 from 'p5';
import { $, reportRuntime } from './status.js';

export const WIDTH = 1920, HEIGHT = 1080;

export const canvas = $('hydra');
// Fixed render resolution; the canvas is only CSS-scaled for display.
canvas.width = WIDTH;
canvas.height = HEIGHT;

// makeGlobal puts Hydra's functions (osc, src, time, render, ...) on window, where sketches run.
// We drive the loop ourselves so the offline renderer can pause it and step time exactly.
export const hydra = new Hydra({ canvas, width: WIDTH, height: HEIGHT, detectAudio: false, makeGlobal: true, autoLoop: false });

let paused = false;
let lastFrame = performance.now();
requestAnimationFrame(function frame(now) {
  // rAF's timestamp can predate a performance.now() taken just before (load, end of a render); never step time backwards.
  if (!paused) { guardUpdate(); hydra.tick(Math.max(0, now - lastFrame)); }
  lastFrame = now;
  requestAnimationFrame(frame);
});

export function pauseLive() { paused = true; }
export function resumeLive() {
  paused = false;
  lastFrame = performance.now(); // don't jump time by however long the pause lasted
}

// Sketches use the global `p5`. Track live instances so the renderer can pause them and redraw once per frame.
export const p5Instances = new Set();
window.p5 = class extends P5 {
  constructor(...args) {
    super(...args);
    p5Instances.add(this);
    const remove = this.remove;
    this.remove = () => { p5Instances.delete(this); remove.call(this); };
  }
};

// Hydra catches errors in per-frame code (arrow-function args, `update`) and only logs them,
// so surface those, plus uncaught ones (p5 draw, timers), in the status bar.
const consoleWarn = console.warn;
console.warn = (...args) => {
  if (args[0] === 'ERROR' && args.length === 2) reportRuntime(args[1]); // Hydra's arg-function catch
  consoleWarn.apply(console, args);
};
window.addEventListener('error', (e) => reportRuntime(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportRuntime(e.reason));

// Hydra re-reads window.update every tick; wrap each new one so its errors are reported, then rethrow for Hydra's log.
let guardedUpdate = null;
export function guardUpdate() {
  const update = window.update;
  if (typeof update !== 'function' || update === guardedUpdate) return;
  guardedUpdate = window.update = (dt) => { try { update(dt); } catch (e) { reportRuntime(e); throw e; } };
}
