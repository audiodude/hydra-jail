// Code in a URL, in hydra.ojack.xyz's ?code= format: base64 of the encodeURIComponent'd code, so links
// work in both apps. encodeCode returns the value ready to put after `?code=`.
export const encodeCode = (code) => encodeURIComponent(btoa(encodeURIComponent(code)));

// The ?code= value as URLSearchParams returns it. A link that left base64's '+' unescaped comes back with
// spaces there (base64 has none). Throws if it isn't valid.
export const decodeCode = (param) => decodeURIComponent(atob(param.replace(/ /g, '+')));

// A link to the demo view of `code`, next to this page (works from file:// too).
export const demoUrl = (code) => new URL(`?code=${encodeCode(code)}`, location.href).href;
