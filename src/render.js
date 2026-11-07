// Frame-exact offline rendering (WebCodecs via Mediabunny), streamed straight to a file on disk.
import { Output, Mp4OutputFormat, StreamTarget, VideoSampleSource, VideoSample, Quality } from 'mediabunny';
import { $, setStatus } from './status.js';
import { WIDTH, HEIGHT, canvas, hydra, p5Instances, guardUpdate, pauseLive, resumeLive } from './hydra.js';
import { createYuvConverter } from './yuv.js';
import { state } from './workspace.js';

// Per render size: pixels, bitrate, and codec strings in preference order. Explicit codec strings because
// Mediabunny derives the AVC level from size and bitrate only, which is too low for 60fps.
const SIZES = {
  1080: { width: WIDTH, height: HEIGHT, bitrate: 20e6, codecs: { 8: [['avc', 'avc1.64002A'], ['vp9', 'vp09.00.41.08']], 10: [['vp9', 'vp09.02.41.10']] } },
  2160: { width: 3840, height: 2160, bitrate: 80e6, codecs: { 8: [['avc', 'avc1.640034'], ['vp9', 'vp09.00.51.08']], 10: [['vp9', 'vp09.02.51.10']] } },
};
const FPS = 60;

// First codec this browser can encode at `size` and `bits`, or null.
async function pickCodec(size, bits) {
  for (const [codec, fullCodecString] of size.codecs[bits]) {
    const config = { codec: fullCodecString, width: size.width, height: size.height, bitrate: size.bitrate, framerate: FPS };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return { codec, fullCodecString };
  }
  return null;
}

// Hydra and the YUV converter need WebGL textures at least as wide as the frame.
let maxTexture;
const glFits = (size) => {
  maxTexture ??= document.createElement('canvas').getContext('webgl2')?.getParameter(WebGL2RenderingContext.MAX_TEXTURE_SIZE) ?? 0;
  return maxTexture >= size.width;
};

// Greys out 4K when this browser can't render it at the chosen depth, falling back to 1080p meanwhile.
// The saved choice is kept, so 4K comes back once it works again (e.g. after switching depth).
let check = 0;
export async function updateSizeOptions(savedSize) {
  const id = ++check;
  const bits = $('render-depth').value === '10' ? 10 : 8;
  const ok = 'VideoEncoder' in window && glFits(SIZES[2160]) && !!(await pickCodec(SIZES[2160], bits));
  if (id !== check) return; // superseded by a later change
  const menu = $('render-size'), option = menu.querySelector('option[value="2160"]');
  option.disabled = !ok;
  option.title = ok ? '' : `this browser can't render ${bits}-bit video at 4K`;
  if (!ok) menu.value = '1080';
  else if (savedSize === '2160') menu.value = '2160';
}

// Yield to the event loop without timer throttling (setTimeout is clamped to 1s in background tabs).
const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });

let rendering = null; // active offline render job, if any

// Offline, frame-exact render: Hydra's `time` advances exactly 1/FPS per frame
// regardless of how long each frame takes, and every frame is encoded.
// Code can still be run mid-render on purpose: it takes effect from the next frame.
export async function renderVideo() {
  if (rendering) { rendering.cancelled = true; return; }
  const secs = Number($('render-secs').value);
  if (!(secs > 0)) return setStatus('render length must be a positive number of seconds', true);
  if (!('VideoEncoder' in window)) return setStatus('WebCodecs not supported in this browser', true);
  if (!('showSaveFilePicker' in window)) return setStatus('rendering saves straight to disk, which needs Chrome or Edge', true);
  const total = Math.round(secs * FPS);
  if (total < 1) return setStatus(`render length must be at least one frame (${(1 / FPS).toFixed(3)} s)`, true);

  // Claim the job before any await, so a second click cancels instead of starting a parallel render.
  const job = rendering = { cancelled: false };
  const btn = $('render');
  btn.classList.add('on');
  const bits = $('render-depth').value === '10' ? 10 : 8;
  const size = SIZES[$('render-size').value] ?? SIZES[1080];
  const paused = new Set();
  const frameUs = 1e6 / FPS;
  let failed = null, handle = null, file = null, saved = false, newFile = false, output = null, yuv = null;
  try {
    // First await, so it still has the click's user activation. Encoded data goes straight to this file,
    // so memory use doesn't grow with length or resolution.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    try {
      handle = await showSaveFilePicker({
        suggestedName: `${state.current ?? 'untitled'}-${stamp}.mp4`,
        types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
      });
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
      return setStatus('render cancelled'); // picker dismissed
    }
    newFile = (await handle.getFile()).size === 0;
    // Writes go to a swap file until close(); abort() discards them, leaving any existing file untouched.
    file = await handle.createWritable();

    pauseLive();
    // Pause looping p5 instances and redraw them once per frame instead. Re-checked every frame, so
    // instances created (or loop()ed) by code run mid-render are caught; ones you stopped yourself stay stopped.
    const pauseLooping = () => { for (const p of p5Instances) if (p.isLooping()) { p.noLoop(); paused.add(p); } };
    pauseLooping();

    const pick = await pickCodec(size, bits);
    if (!pick) throw new Error(`no ${bits === 10 ? '10-bit VP9' : 'H.264/VP9'} encoder for ${size.width}×${size.height}`);
    // Hydra draws at the render size; resizing reallocates its buffers, so feedback restarts from black.
    if (size.width !== WIDTH) hydra.setResolution(size.width, size.height);
    yuv = createYuvConverter(size.width, size.height, bits);

    // Mediabunny closes its stream even on cancel, and closing commits the file, so it gets a wrapper:
    // only a successful render closes the real file.
    const sink = new WritableStream({ write: (chunk) => file.write(chunk) });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(sink, { chunked: true }) });
    const source = new VideoSampleSource({ ...pick, quality: new Quality({ bitrate: size.bitrate }), keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();

    // With `fps` set, Hydra only draws on some ticks, and its canvas isn't preserved between draws.
    // Keep the last drawn frame and re-encode it on skipped ticks, so a low-fps sketch renders as it looks live.
    let lastDrawn = null;
    try {
      for (let i = 0; i < total && !job.cancelled; i++) {
        pauseLooping();
        for (const p of paused) if (p5Instances.has(p) && p._setupDone) p.redraw();
        guardUpdate();
        // Force a draw on the first frame, otherwise the video opens on blank frames until the fps interval elapses.
        if (i === 0 && window.fps) hydra.timeSinceLastUpdate = Math.max(hydra.timeSinceLastUpdate, 1000 / window.fps);
        hydra.tick(1000 / FPS);
        // Convert in the same task as the draw: Hydra's WebGL canvas doesn't preserve its buffer.
        if (hydra.timeSinceLastUpdate === 0 || !lastDrawn) { lastDrawn?.close(); lastDrawn = yuv.frame(canvas); }
        // The sample wraps (and closes) its own frame; add() awaits encoder backpressure and clones what it keeps.
        const sample = new VideoSample(new VideoFrame(lastDrawn, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) }));
        try { await source.add(sample); } finally { sample.close(); }
        if (i % 6 === 0) {
          btn.textContent = `⏹ ${Math.floor((i / total) * 100)}%`;
          await yieldTask();
        }
      }
    } finally {
      lastDrawn?.close();
    }
    if (!job.cancelled) {
      await output.finalize();
      await file.close();
      saved = true;
    }
  } catch (e) {
    failed = e;
  } finally {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    if (!saved) {
      await file?.abort().catch(() => {});
      if (newFile) await handle.remove?.().catch(() => {}); // don't leave an empty file behind
    }
    yuv?.destroy();
    if (hydra.width !== WIDTH) hydra.setResolution(WIDTH, HEIGHT);
    for (const p of paused) if (p5Instances.has(p)) p.loop(); // not ones removed mid-render
    rendering = null;
    resumeLive();
    btn.classList.remove('on');
    btn.textContent = '⏵ Render';
  }
  if (failed) return setStatus(`render failed: ${failed.message ?? failed}`, true);
  if (job.cancelled) return setStatus('render cancelled');
  setStatus(`saved ${handle.name}`);
}
