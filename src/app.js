// The editor app, loaded by main.js. Everything is module-scoped: Hydra's makeGlobal overwrites window globals like `render`.
import { resolveImage } from './hydra.js'; // first: sets up Hydra's globals and the tracked window.p5 before any sketch runs
import { $, setStatus } from './status.js';
import { KEY, store } from './storage.js';
import { editor, run, lastRunHung, startupError } from './workspace.js';
import { render, newSketch } from './explorer.js';
import { restoreSidebar, toggleView } from './sidebar.js';
import { renderVideo, updateSizeOptions } from './render.js';
import { exportSketches, importSketches } from './transfer.js';
import './colors.js';
import { demoUrl, encodeCode } from './share.js';
import './style.css'; // after the modules, so it overrides CodeMirror's own CSS (same selectors)

$('render').onclick = renderVideo;
$('run').onclick = run;
$('new-sketch').onclick = newSketch;
$('toggle-explorer').onclick = () => toggleView('explorer');
$('toggle-utilities').onclick = () => toggleView('utilities');
$('export-sketches').onclick = exportSketches;
$('import-sketches').onclick = () => $('import-file').click();
$('import-file').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so picking the same file again still fires
  if (file) importSketches(file);
};
$('scale').onclick = (e) => {
  const actual = $('stage').classList.toggle('actual');
  e.target.textContent = actual ? 'fit' : '1:1';
};
// hydra.ojack.xyz runs ?code= on load. It has no image host, so bare initImage('foo.jpg') names are
// rewritten to the full URLs they load from here.
$('open-hydra').onclick = () => {
  const code = editor.getValue().replace(/(\.initImage\(\s*)(['"])([^'"\\\n]*)\2/g,
    (_, call, q, url) => call + q + resolveImage(url) + q);
  window.open(`https://hydra.ojack.xyz/?code=${encodeCode(code)}`, '_blank', 'noopener');
};
$('demo').onclick = () => window.open(demoUrl(editor.getValue()), '_blank', 'noopener');
// Render menus remember their choice.
for (const [id, key] of [['render-depth', KEY.renderDepth], ['render-size', KEY.renderSize]]) {
  const menu = $(id), saved = localStorage.getItem(key);
  if ([...menu.options].some((o) => o.value === saved)) menu.value = saved;
  menu.onchange = () => store(key, menu.value);
}
// 4K depends on the depth (10-bit 4K may be unsupported where 8-bit isn't).
const checkSizes = () => updateSizeOptions(localStorage.getItem(KEY.renderSize));
$('render-depth').addEventListener('change', checkSizes);
checkSizes();

restoreSidebar();
render();
if (lastRunHung()) setStatus('auto-run skipped: the last run hung or crashed the page. Fix the code, then Run.', true);
else run();
if (startupError) setStatus(startupError, true);
document.fonts.ready.then(() => editor.refresh()); // re-measure once Ubuntu Mono loads
