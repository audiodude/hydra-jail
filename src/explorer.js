// The sketch explorer: list, inline naming, save/open/rename/delete, and their shortcuts.
import { $, setStatus } from './status.js';
import { KEY, readSketches } from './storage.js';
import { isOpen, toggleView } from './sidebar.js';
import { DEFAULT_CODE, editor, state, isDirty, saveBuffer, commit, run } from './workspace.js';

const tab = $('tab'), list = $('sketch-list');

const claim = (s, name) => { if (s.has(name)) throw new Error(`"${name}" already exists`); };
const confirmDiscard = () => !isDirty() || confirm(`Discard unsaved changes to "${state.current ?? 'untitled'}"?`);

let wasDirty = false;
export function render() {
  const { sketches, current } = state;
  wasDirty = isDirty();
  tab.textContent = current ?? 'untitled';
  tab.classList.toggle('dirty', wasDirty);
  list.replaceChildren();
  const names = [...sketches.keys()].sort((a, b) => a.localeCompare(b));
  if (!names.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No sketches. Ctrl+S to save.';
    list.append(li);
  }
  for (const name of names) {
    const li = document.createElement('li');
    const dirty = name === current && wasDirty;
    li.title = name;
    li.classList.toggle('active', name === current);
    li.classList.toggle('dirty', dirty);
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      ...(dirty ? [iconButton('↺', 'Revert to saved', revert)] : []),
      iconButton('✎', 'Rename', () => rename(name, li)),
      iconButton('×', 'Delete', () => remove(name)),
    );
    li.append(label, actions);
    li.onclick = () => open(name);
    li.ondblclick = () => rename(name, li);
    list.append(li);
  }
}

function iconButton(text, title, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

function revert() {
  if (!confirm(`Revert "${state.current}" to its saved version?`)) return;
  editor.setValue(state.sketches.get(state.current));
  render();
  run();
}

function open(name) {
  if (name === state.current || !confirmDiscard()) return;
  state.current = name;
  editor.setValue(state.sketches.get(name));
  editor.clearHistory();
  render();
  run();
}

// Inline VSCode-style name input. Replaces `li`'s contents (or prepends a new row).
// Enter/blur commits, Escape cancels. onCommit receives a valid, unused name.
function nameInput(initial, li, onCommit) {
  if (!isOpen('explorer')) toggleView('explorer');
  if (!li) { li = document.createElement('li'); list.prepend(li); }
  li.className = 'editing';
  li.onclick = li.ondblclick = null;
  const input = document.createElement('input');
  input.value = initial;
  li.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const validate = () => {
    const name = input.value.trim();
    const ok = name !== '' && (name === initial || !state.sketches.has(name));
    input.classList.toggle('invalid', !ok);
    input.title = ok ? '' : name ? `"${name}" already exists` : 'Name required';
    return ok ? name : null;
  };
  const finish = (commit) => {
    if (done) return;
    const name = commit ? validate() : null;
    if (commit && name === null && input.value.trim() !== '') return; // keep editing a duplicate
    done = true;
    if (name !== null) onCommit(name);
    render();
    // Defer: focusing the editor mid-keystroke lets the rest of the Enter
    // (keypress/input) land in CodeMirror in some browsers.
    setTimeout(() => editor.focus());
  };
  input.oninput = validate;
  input.onkeydown = (e) => {
    // Ctrl/Cmd+S in the input commits it, like Enter, instead of opening a second name input.
    const saveKey = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's';
    if (e.key !== 'Enter' && e.key !== 'Escape' && !saveKey) return;
    e.preventDefault();
    e.stopPropagation();
    finish(e.key !== 'Escape');
  };
  input.onblur = () => finish(input.value.trim() !== '' && validate() !== null);
}

function save() {
  if (state.current === null) return saveAs();
  const name = state.current, code = editor.getValue();
  if (!commit((s) => s.set(name, code))) return;
  saveBuffer();
  render();
  setStatus(`saved "${name}"`);
}

function saveAs() {
  nameInput('', null, (name) => {
    const code = editor.getValue();
    if (!commit((s) => { claim(s, name); s.set(name, code); })) return;
    state.current = name;
    saveBuffer();
    setStatus(`saved "${name}"`);
  });
}

export function newSketch() {
  // Confirm on commit, not before: a native dialog closing right before the
  // name input appears steals its focus, and blur-while-empty cancels it.
  nameInput('', null, (name) => {
    if (!confirmDiscard()) return;
    if (!commit((s) => { claim(s, name); s.set(name, DEFAULT_CODE); })) return;
    state.current = name;
    editor.setValue(DEFAULT_CODE);
    editor.clearHistory();
    run();
  });
}

function rename(name, li) {
  nameInput(name, li, (newName) => {
    if (newName === name) return;
    const ok = commit((s) => {
      if (!s.has(name)) throw new Error(`"${name}" no longer exists`);
      claim(s, newName);
      s.set(newName, s.get(name));
      s.delete(name);
    });
    if (ok && state.current === name) { state.current = newName; saveBuffer(); }
  });
}

function remove(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  if (!commit((s) => s.delete(name))) return;
  if (state.current === name) { state.current = null; saveBuffer(); } // editor keeps the code as untitled
  render();
}

editor.on('change', () => { if (isDirty() !== wasDirty) render(); });

// Another tab changed the sketches: pick them up. The open sketch, if deleted there, becomes untitled here.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY.sketches && e.key !== null) return;
  const next = readSketches();
  if (!next) return;
  state.sketches = next;
  if (state.current !== null && !next.has(state.current)) state.current = null;
  if (!list.querySelector('.editing')) render(); // an open name input re-renders when it finishes
});

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
  else if (k === 'b' && !e.shiftKey) { e.preventDefault(); toggleView('explorer'); }
});
