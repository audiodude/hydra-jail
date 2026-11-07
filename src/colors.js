// Utilities ▸ Color: an eyedropper, a rainbow to pick from, and a hex or rgb()/rgba() color → `r, g, b, a`,
// the arguments for Hydra's .color(), each channel scaled to 0–1.
import { $, setStatus } from './status.js';

const hex = $('color-hex'), out = $('color-out'), swatch = $('color-swatch'), copy = $('copy-color'), dropper = $('eyedropper');

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const RGB = new RegExp(String.raw`^rgba?\(\s*${NUM}\s*[,\s]\s*${NUM}\s*[,\s]\s*${NUM}\s*(?:[,/]\s*${NUM}(%?)\s*)?\)$`, 'i');

// '#rgb', '#rgba', '#rrggbb', '#rrggbbaa' (the '#' optional), 'rgb(r, g, b)' or 'rgba(r, g, b, a)'
// (channels 0–255, alpha 0–1 or a percentage; commas or spaces) → [r, g, b, a] in 0–1, or null.
function parseColor(text) {
  const t = text.trim();
  const m = RGB.exec(t);
  if (m) {
    const [, r, g, b, a = '1', pct] = m;
    const rgb = [r, g, b].map(Number);
    const alpha = pct ? +a / 100 : +a;
    return rgb.every((c) => c <= 255) && alpha <= 1 ? [...rgb.map((c) => c / 255), alpha] : null;
  }
  let h = t.replace(/^#/, '');
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  return h.match(/../g).map((p) => parseInt(p, 16) / 255);
}

function convert() {
  const c = parseColor(hex.value);
  hex.classList.toggle('invalid', hex.value.trim() !== '' && !c);
  out.textContent = c ? c.map((v) => +v.toFixed(3)).join(', ') : '';
  copy.disabled = !c;
  swatch.style.setProperty('--c', c ? `rgb(${c.slice(0, 3).map((v) => v * 100 + '%').join(' ')} / ${c[3]})` : 'transparent');
}

// Rainbow: hue top to bottom, white at the left through full color in the middle to black at the right.
const rainbow = $('rainbow');
const ctx = rainbow.getContext('2d', { willReadFrequently: true });
const { width: W, height: H } = rainbow;
const hues = ctx.createLinearGradient(0, 0, 0, H);
for (let i = 0; i <= 6; i++) hues.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
ctx.fillStyle = hues;
ctx.fillRect(0, 0, W, H);
const shade = ctx.createLinearGradient(0, 0, W, 0);
shade.addColorStop(0, '#fff');
shade.addColorStop(0.5, '#fff0');
shade.addColorStop(0.5, '#0000');
shade.addColorStop(1, '#000');
ctx.fillStyle = shade;
ctx.fillRect(0, 0, W, H);

function pick(e) {
  const r = rainbow.getBoundingClientRect();
  const x = Math.min(W - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * H)));
  const [red, green, blue] = ctx.getImageData(x, y, 1, 1).data;
  hex.value = `rgb(${red}, ${green}, ${blue})`;
  convert();
}
rainbow.onpointerdown = (e) => { rainbow.setPointerCapture(e.pointerId); pick(e); };
rainbow.onpointermove = (e) => { if (rainbow.hasPointerCapture(e.pointerId)) pick(e); };

hex.oninput = convert;
copy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(out.textContent);
    setStatus(`copied ${out.textContent}`);
  } catch (e) {
    setStatus(`couldn't copy: ${e.message}`, true);
  }
};

if (!('EyeDropper' in window)) {
  dropper.disabled = true;
  dropper.title = "This browser has no eyedropper (Chrome and Edge do)";
}
dropper.onclick = async () => {
  try {
    const { sRGBHex } = await new EyeDropper().open();
    hex.value = sRGBHex;
    convert();
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(`eyedropper failed: ${e.message}`, true); // AbortError: Escape pressed
  }
};
convert();
