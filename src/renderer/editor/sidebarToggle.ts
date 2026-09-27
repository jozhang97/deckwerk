import { barButton } from './shellWiring.js';

const STORAGE_KEY = 'deckwerk.editor.sidebar-visible';

/** A view preference shared by both editor shells, independent of the deck. */
export function createSidebarToggle(body: HTMLElement, side: HTMLElement): HTMLButtonElement {
  let visible = true;
  try { visible = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* Storage may be unavailable. */ }
  const button = barButton('', () => {
    // Commit a focused inspector field before its panel leaves the layout.
    if (visible && side.contains(document.activeElement)) button.focus();
    visible = !visible;
    sync();
    try { localStorage.setItem(STORAGE_KEY, String(visible)); } catch { /* Keep the session usable. */ }
  });
  button.classList.add('bar-icon-button', 'sidebar-toggle');
  button.innerHTML = '<svg class="bar-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
    + '<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor"/>'
    + '<path d="M10 3v10" fill="none" stroke="currentColor"/></svg>';
  button.setAttribute('aria-controls', side.id);
  function sync(): void {
    body.classList.toggle('sidebar-collapsed', !visible);
    button.setAttribute('aria-pressed', String(visible));
    button.title = visible ? 'Hide right sidebar' : 'Show right sidebar';
    button.setAttribute('aria-label', button.title);
  }
  sync();
  return button;
}
