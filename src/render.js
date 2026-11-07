// Live recording (MediaRecorder) and frame-exact offline rendering (WebCodecs via Mediabunny).
import { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, Quality } from 'mediabunny';
import { $, setStatus } from './status.js';
import { WIDTH, HEIGHT, canvas, hydra, p5Instances, guardUpdate, pauseLive, resumeLive } from './hydra.js';
import { state } from './workspace.js';

function download(blob, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `${state.current ?? 'untitled'}-${stamp}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus(`saved ${a.download}`);
}

let recorder = null;
export function toggleRecording() {
  const btn = $('record');
  if (recorder) { recorder.stop(); return; }
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return setStatus('recording not supported in this browser', true);
  const chunks = [];
  const started = Date.now();
  recorder = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 20e6 });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    btn.textContent = `⏹ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  recorder.onstop = () => {
    clearInterval(tick);
    recorder = null;
    btn.classList.remove('on');
    btn.textContent = '⏺ Rec';
    $('render').disabled = false;
    download(new Blob(chunks, { type: 'video/webm' }), 'webm');
  };
  recorder.start(1000); // flush every second so a long take isn't one giant buffer
  btn.classList.add('on');
  btn.textContent = '⏹ 0:00';
  $('render').disabled = true;
}

// Yield to the event loop without timer throttling (setTimeout is clamped to 1s in background tabs).
const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });

let rendering = null; // active offline render job, if any

// Offline, frame-exact render: Hydra's `time` advances exactly 1/FPS per frame
// regardless of how long each frame takes, and every frame is encoded.
// Code can still be run mid-render on purpose: it takes effect from the next frame.
export async function renderVideo() {
  if (rendering) { rendering.cancelled = true; return; }
  const FPS = 60;
  const MAX_SECS = 300; // the whole file is held in memory (~150 MB/min at 20 Mbps), then copied into a Blob
  const secs = Number($('render-secs').value);
  if (!(secs > 0)) return setStatus('render length must be a positive number of seconds', true);
  if (secs > MAX_SECS) return setStatus(`render length is capped at ${MAX_SECS} s (5 min) to avoid running out of memory`, true);
  if (!('VideoEncoder' in window)) return setStatus('WebCodecs not supported in this browser', true);
  const total = Math.round(secs * FPS);
  if (total < 1) return setStatus(`render length must be at least one frame (${(1 / FPS).toFixed(3)} s)`, true);

  // Claim the job before any await, so a second click cancels instead of starting a parallel render.
  const job = rendering = { cancelled: false };
  pauseLive();
  const btn = $('render');
  btn.classList.add('on');
  $('record').disabled = true;
  // Pause looping p5 instances and redraw them once per frame instead. Re-checked every frame, so
  // instances created (or loop()ed) by code run mid-render are caught; ones you stopped yourself stay stopped.
  const paused = new Set();
  const pauseLooping = () => { for (const p of p5Instances) if (p.isLooping()) { p.noLoop(); paused.add(p); } };
  pauseLooping();
  const frameUs = 1e6 / FPS;
  let failed = null, output = null;
  try {
    // Explicit codec strings: Mediabunny derives the AVC level from size and bitrate only, giving 4.0, too low for 1080p60.
    let pick = null;
    for (const [codec, fullCodecString] of [['avc', 'avc1.64002A'], ['vp9', 'vp09.00.41.08']]) {
      const config = { codec: fullCodecString, width: WIDTH, height: HEIGHT, bitrate: 20e6, framerate: FPS };
      if ((await VideoEncoder.isConfigSupported(config)).supported) { pick = { codec, fullCodecString }; break; }
    }
    if (!pick) throw new Error('no supported H.264/VP9 encoder for 1920×1080');

    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new VideoSampleSource({ ...pick, quality: new Quality({ bitrate: 20e6 }), keyFrameInterval: 2 });
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
        // Capture in the same task as the draw: Hydra's WebGL canvas doesn't preserve its buffer.
        if (hydra.timeSinceLastUpdate === 0 || !lastDrawn) { lastDrawn?.close(); lastDrawn = new VideoFrame(canvas, { timestamp: 0 }); }
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
    if (!job.cancelled) await output.finalize();
  } catch (e) {
    failed = e;
  } finally {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    for (const p of paused) if (p5Instances.has(p)) p.loop(); // not ones removed mid-render
    rendering = null;
    resumeLive();
    btn.classList.remove('on');
    btn.textContent = '⏵ Render';
    $('record').disabled = false;
  }
  if (failed) return setStatus(`render failed: ${failed.message ?? failed}`, true);
  if (job.cancelled) return setStatus('render cancelled');
  download(new Blob([output.target.buffer], { type: 'video/mp4' }), 'mp4');
}
