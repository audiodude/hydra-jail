// Entry point. Everything is module-scoped: Hydra's makeGlobal overwrites window globals like `render`.
import './hydra.js'; // first: sets up Hydra's globals and the tracked window.p5 before any sketch runs
import { $, setStatus } from './status.js';
import { KEY, store } from './storage.js';
import { editor, run, lastRunHung, startupError } from './workspace.js';
import { render, newSketch, toggleExplorer } from './explorer.js';
import { renderVideo, updateSizeOptions } from './render.js';
import './style.css'; // after the modules, so it overrides CodeMirror's own CSS (same selectors)

$('render').onclick = renderVideo;
$('run').onclick = run;
$('new-sketch').onclick = newSketch;
$('toggle-explorer').onclick = toggleExplorer;
$('scale').onclick = (e) => {
  const actual = $('stage').classList.toggle('actual');
  e.target.textContent = actual ? 'fit' : '1:1';
};
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

if (localStorage.getItem(KEY.explorer) !== 'closed') toggleExplorer();
else editor.refresh();
render();
if (lastRunHung()) setStatus('auto-run skipped: the last run hung or crashed the page. Fix the code, then Run.', true);
else run();
if (startupError) setStatus(startupError, true);
document.fonts.ready.then(() => editor.refresh()); // re-measure once Ubuntu Mono loads
