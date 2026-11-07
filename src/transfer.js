// Export all sketches to a .json file, and import one by merging or overwriting.
// The file is the same { name: code } object kept in localStorage.
import { $, setStatus } from './status.js';
import { parseSketches } from './storage.js';
import { state, commit, saveBuffer } from './workspace.js';
import { render } from './explorer.js';

export function exportSketches() {
  if (!state.sketches.size) return setStatus('no saved sketches to export', true);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(Object.fromEntries(state.sketches), null, 2)], { type: 'application/json' }));
  a.download = `hydra-jail-sketches-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus(`exported ${plural(state.sketches.size)}`);
}

const plural = (n) => `${n} sketch${n === 1 ? '' : 'es'}`;

// Merge never loses anything: new names are added, identical copies skipped, and a name already
// used for different code comes in as "name (imported)" (then "(imported 2)", ...).
function merge(mine, theirs) {
  let added = 0, renamed = 0;
  for (const [name, code] of theirs) {
    if (mine.get(name) === code) continue;
    let target = name;
    if (mine.has(name)) {
      for (let i = 1; mine.has(target) && mine.get(target) !== code; i++) target = `${name} (imported${i > 1 ? ` ${i}` : ''})`;
      if (mine.get(target) === code) continue; // imported before
      renamed++;
    } else added++;
    mine.set(target, code);
  }
  return { added, renamed };
}

export async function importSketches(file) {
  let theirs = parseSketches(await file.text());
  if (!theirs) return setStatus(`${file.name} isn't a sketches file`, true);
  // Same rule as names typed in the explorer: trimmed, non-empty.
  theirs = new Map([...theirs].map(([n, c]) => [n.trim(), c]).filter(([n]) => n));
  if (!theirs.size) return setStatus(`${file.name} has no sketches`, true);

  const mine = state.sketches;
  const clashes = [...theirs].filter(([n, c]) => mine.has(n) && mine.get(n) !== c).length;
  $('import-summary').textContent = `${file.name}: ${plural(theirs.size)}`
    + (mine.size ? `, ${clashes} with a name you already use for different code. You have ${plural(mine.size)}.` : '.');
  const dialog = $('import-dialog');
  dialog.returnValue = ''; // don't carry over the last import's choice
  dialog.showModal();
  const choice = await new Promise((r) => dialog.addEventListener('close', () => r(dialog.returnValue), { once: true }));
  // Only an explicit choice acts: Escape closes with returnValue "".
  if (choice !== 'merge' && choice !== 'overwrite') return setStatus('import cancelled');

  let result;
  const ok = commit((s) => {
    if (choice === 'overwrite') { s.clear(); for (const [n, c] of theirs) s.set(n, c); }
    else result = merge(s, theirs);
  });
  if (!ok) return;
  // Overwriting can remove the open sketch; its code stays in the editor, untitled.
  if (state.current !== null && !state.sketches.has(state.current)) { state.current = null; saveBuffer(); }
  render();
  setStatus(choice === 'overwrite'
    ? `replaced your sketches with ${plural(theirs.size)} from ${file.name}`
    : `merged ${file.name}: ${result.added} added, ${result.renamed} renamed as "(imported)", ${theirs.size - result.added - result.renamed} already here`);
}
