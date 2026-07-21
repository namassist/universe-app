/* Open a display (TV) screen in a new tab — the screen requests fullscreen itself. */
export function openDisplay(url: string) {
  window.open(url, "_blank", "noopener");
}
