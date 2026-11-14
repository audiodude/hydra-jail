// Entry point: ?code= opens the demo view (just the canvas, running that code), anything else the editor.
// Dynamic imports so the demo never loads the editor, whose modules read and autosave localStorage.
const param = new URLSearchParams(location.search).get('code');
if (param === null) import('./app.js');
else import('./demo.js').then((demo) => demo.start(param));
