// Mic on/off for Hydra's `a`. It starts silent (see hydra.js); turning the mic on attaches the same analyser
// Hydra's Audio constructor would, to the same object, so a sketch's a.setBins/onBeat/etc. carry over.
import Meyda from 'meyda';
import { hydra } from './hydra.js';

const a = hydra.synth.a;

export const micOn = () => Boolean(a.stream);

export async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
  const context = new AudioContext();
  a.meyda = Meyda.createMeydaAnalyzer({
    audioContext: context,
    source: context.createMediaStreamSource(stream),
    featureExtractors: ['loudness'],
  });
  a.stream = stream;
  a.context = context;
}

export function stopMic() {
  a.stream.getTracks().forEach((t) => t.stop());
  a.context.close();
  a.meyda = a.stream = a.context = undefined; // a.tick() is a no-op without meyda
  a.vol = 0;
  for (const bins of [a.bins, a.prevBins, a.fft]) bins.fill(0); // back to silence, not the last reading
}
