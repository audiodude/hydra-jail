export const $ = (id) => document.getElementById(id);

const status = $('status');

export function setStatus(text, isError = false) {
  status.className = isError ? 'err' : '';
  status.textContent = text;
}

// For errors raised while frames draw: repeats every frame, so only touch the DOM when the message changes.
export function reportRuntime(e) {
  const text = `runtime error: ${e?.message ?? e}`;
  if (status.textContent !== text) setStatus(text, true);
}
