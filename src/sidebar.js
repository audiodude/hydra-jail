// The sidebar shows one view at a time, picked from the activity bar. Clicking the open view's icon closes it.
import { $ } from './status.js';
import { KEY, store } from './storage.js';
import { editor } from './workspace.js';

const VIEWS = ['explorer', 'utilities']; // each has an <aside id=NAME> and a <button id=toggle-NAME>

export const isOpen = (name) => !$(name).classList.contains('closed');

export function toggleView(name) {
  const open = isOpen(name) ? null : name;
  for (const v of VIEWS) {
    $(v).classList.toggle('closed', v !== open);
    $(`toggle-${v}`).classList.toggle('on', v === open);
  }
  store(KEY.sidebar, open ?? 'closed');
  editor.refresh();
}

// Restores the last view. Missing or unknown (never set, or from before utilities existed): the explorer.
export function restoreSidebar() {
  const saved = localStorage.getItem(KEY.sidebar);
  if (saved === 'closed') editor.refresh();
  else toggleView(VIEWS.includes(saved) ? saved : 'explorer');
}
