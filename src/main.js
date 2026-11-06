// Entry point. Everything is module-scoped: Hydra's makeGlobal overwrites window globals like `render`.
import './hydra.js'; // first: sets up Hydra's globals and the tracked window.p5 before any sketch runs
import { $, setStatus } from './status.js';
import { KEY } from './storage.js';
import { editor, run, lastRunHung, startupError } from './workspace.js';
import { render, newSketch, toggleExplorer } from './explorer.js';
import { toggleRecording, renderVideo } from './render.js';
import './style.css'; // after the modules, so it overrides CodeMirror's own CSS (same selectors)

$('record').onclick = toggleRecording;
$('render').onclick = renderVideo;
$('run').onclick = run;
$('new-sketch').onclick = newSketch;
$('toggle-explorer').onclick = toggleExplorer;
$('scale').onclick = (e) => {
  const actual = $('stage').classList.toggle('actual');
  e.target.textContent = actual ? 'fit' : '1:1';
};

if (localStorage.getItem(KEY.explorer) !== 'closed') toggleExplorer();
else editor.refresh();
render();
if (lastRunHung()) setStatus('auto-run skipped: the last run hung or crashed the page. Fix the code, then Run.', true);
else run();
if (startupError) setStatus(startupError, true);
document.fonts.ready.then(() => editor.refresh()); // re-measure once Ubuntu Mono loads
