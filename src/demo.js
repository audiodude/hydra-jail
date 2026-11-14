// Demo view (?code=): the canvas alone, filling the window, running the code from the URL.
// Never touches localStorage, so opening a demo leaves your buffer and sketches alone.
import './hydra.js'; // Hydra's globals, the frame loop and runtime error reporting
import { setStatus } from './status.js';
import { decodeCode } from './share.js';
import './style.css';

export function start(param) {
  document.body.classList.add('demo');
  let code;
  try {
    code = decodeCode(param);
  } catch {
    setStatus('could not decode ?code= (expected base64 of the URI-encoded code, as hydra.ojack.xyz uses)', true);
    return;
  }
  try {
    (0, eval)(code); // global scope, where Hydra's functions live
  } catch (e) {
    setStatus(String(e), true);
  }
}
