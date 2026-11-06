// The editor, the open sketch, and running code.
import CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/blackboard.css';
import { $, setStatus } from './status.js';
import { KEY, loadSketches, store, writeSketches } from './storage.js';

export const DEFAULT_CODE = `osc(10, 0.1, 1.2)
  .rotate(() => time * 0.1)
  .kaleid(4)
  .out()`;

const loaded = loadSketches();
export const startupError = loaded.error;

// sketches: last known stored sketches. current: name of the open sketch, or null for untitled.
export const state = { sketches: loaded.sketches, current: localStorage.getItem(KEY.current) };
if (!state.sketches.has(state.current)) state.current = null;

export const editor = CodeMirror($('editor'), {
  value: localStorage.getItem(KEY.buffer) ?? (state.current ? state.sketches.get(state.current) : DEFAULT_CODE),
  mode: 'javascript',
  theme: 'blackboard',
  lineNumbers: true,
  tabSize: 2,
  extraKeys: { 'Shift-Ctrl-Enter': () => run(), 'Shift-Cmd-Enter': () => run() },
});

// Untitled counts as dirty once it differs from the starter code, so switching away asks first.
export const isDirty = () =>
  editor.getValue() !== (state.current === null ? DEFAULT_CODE : state.sketches.get(state.current));

// The buffer and the open sketch's name are written together so a reload restores a matching pair.
export const saveBuffer = () => store(KEY.buffer, editor.getValue()) && store(KEY.current, state.current);

// Applies a change to the stored sketches; false (already reported) if it couldn't be written.
export function commit(mutate) {
  const next = writeSketches(mutate);
  if (next) state.sketches = next;
  return next !== null;
}

// The running flag is set while code runs and for a moment after; a load that finds it set means the last run hung.
let runningTimer = 0;
export function run() {
  const code = editor.getValue();
  const saved = saveBuffer();
  sessionStorage.setItem(KEY.running, '1');
  clearTimeout(runningTimer);
  runningTimer = setTimeout(() => sessionStorage.removeItem(KEY.running), 2000);
  try {
    (0, eval)(code); // global scope, where Hydra's functions live
    if (saved) setStatus(`ran at ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus(String(e), true);
  }
}

// Called once at startup: true (and clears the flag) if the previous run hung the page.
export function lastRunHung() {
  if (!sessionStorage.getItem(KEY.running)) return false;
  sessionStorage.removeItem(KEY.running);
  return true;
}

// Autosave the buffer as you type, so closing the tab never loses unrun edits.
let bufferTimer = 0;
editor.on('change', () => {
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(saveBuffer, 500);
});
window.addEventListener('pagehide', () => {
  clearTimeout(bufferTimer);
  saveBuffer();
  sessionStorage.removeItem(KEY.running); // a normal unload, not a hang
});
