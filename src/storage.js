// localStorage layout and the safe read/write helpers around it. No app state lives here.
import { setStatus } from './status.js';

export const KEY = {
  buffer: 'hydra-jail:code',         // working buffer, autosaved as you type
  sketches: 'hydra-jail:sketches',   // { name: code }
  current: 'hydra-jail:current',     // name of the open sketch
  explorer: 'hydra-jail:explorer',   // 'closed' when collapsed
  running: 'hydra-jail:running',     // sessionStorage: set while a run might still hang the page
};

// Map, not a plain object, so names like "__proto__" are safe. Returns null if the stored data is unreadable.
export function readSketches() {
  const raw = localStorage.getItem(KEY.sketches);
  if (raw === null) return new Map();
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && Object.values(obj).every((v) => typeof v === 'string')) {
      return new Map(Object.entries(obj));
    }
  } catch {}
  return null;
}

// Startup read. Unreadable data is moved aside instead of being left for the next save to overwrite.
export function loadSketches() {
  const sketches = readSketches();
  if (sketches) return { sketches, error: null };
  const backup = `${KEY.sketches}:corrupt-${Date.now()}`;
  try {
    localStorage.setItem(backup, localStorage.getItem(KEY.sketches));
    localStorage.removeItem(KEY.sketches);
    return { sketches: new Map(), error: `saved sketches were unreadable; raw data moved to localStorage["${backup}"]` };
  } catch {
    return { sketches: new Map(), error: 'saved sketches are unreadable and could not be backed up; saving is disabled' };
  }
}

// localStorage write that reports failure (e.g. quota exceeded) instead of throwing.
export function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch (e) {
    setStatus(`not saved to localStorage: ${e.message}`, true);
    return false;
  }
}

// Read-modify-write against storage, so sketches saved from other tabs aren't clobbered.
// `mutate` may throw to abort. Returns the new sketches, or null (reported) if nothing was written.
export function writeSketches(mutate) {
  const next = readSketches();
  try {
    if (!next) throw new Error('stored sketches are unreadable; not overwriting them');
    mutate(next);
    localStorage.setItem(KEY.sketches, JSON.stringify(Object.fromEntries(next)));
    return next;
  } catch (e) {
    setStatus(`not saved: ${e.message}`, true);
    return null;
  }
}
