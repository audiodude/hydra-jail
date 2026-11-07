// localStorage layout and the safe read/write helpers around it. No app state lives here.
import { setStatus } from './status.js';

export const KEY = {
  buffer: 'hydra-jail:code',         // working buffer, autosaved as you type
  sketches: 'hydra-jail:sketches',   // { name: code }
  current: 'hydra-jail:current',     // name of the open sketch
  sidebar: 'hydra-jail:explorer',    // open sidebar view ('explorer', 'utilities') or 'closed'; old key name, so saved state carries over
  renderDepth: 'hydra-jail:render-depth', // '10' for 10-bit VP9 renders
  renderSize: 'hydra-jail:render-size',   // '2160' for 4K renders
  running: 'hydra-jail:running',     // sessionStorage: set while a run might still hang the page
};

// { name: code } JSON → Map, or null if it isn't that shape. Map, not a plain object, so names like
// "__proto__" are safe. Shared by localStorage and exported files, which use the same format.
export function parseSketches(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && Object.values(obj).every((v) => typeof v === 'string')) {
      return new Map(Object.entries(obj));
    }
  } catch {}
  return null;
}

// Returns null if the stored data is unreadable.
export function readSketches() {
  const raw = localStorage.getItem(KEY.sketches);
  return raw === null ? new Map() : parseSketches(raw);
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
