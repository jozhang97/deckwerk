import { youtubeUrl } from '@shared/youtube.js';

/** URL entry and cancellation use the shared workflow chrome; progress lives in the status bar. */
export function showYoutubeDialog(importVideo: (url: string) => Promise<void>, cancelImport: () => Promise<void>): void {
  if (document.getElementById('youtube-dialog-title')) return;
  const returnFocus = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'workflow-overlay';
  overlay.innerHTML = `<section class="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="youtube-dialog-title">
    <h2 id="youtube-dialog-title">Import YouTube video</h2>
    <p class="confirm-dialog-description">Download a video into this presentation for offline playback, up to 1080p.</p>
    <label class="field"><span>Video link</span><input type="url" placeholder="https://www.youtube.com/watch?v=…" aria-describedby="youtube-error"></label>
    <p id="youtube-error" class="confirm-dialog-description" role="alert" hidden></p>
    <div class="workflow-actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-submit>Download and add</button></div>
  </section>`;
  const input = overlay.querySelector('input')!;
  const submit = overlay.querySelector<HTMLButtonElement>('[data-submit]')!;
  const cancel = overlay.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const error = overlay.querySelector<HTMLElement>('#youtube-error')!;
  let busy = false;
  let cancelling = false;
  const close = () => { overlay.remove(); if (returnFocus?.isConnected) returnFocus.focus(); };
  const cancelAction = async () => {
    if (!busy) { close(); return; }
    if (cancelling) return;
    cancelling = true;
    cancel.disabled = true;
    try { await cancelImport(); }
    catch (e) { error.hidden = false; error.textContent = String(e); cancelling = false; cancel.disabled = false; }
  };
  const start = async () => {
    if (busy) return;
    error.hidden = true;
    try {
      const url = youtubeUrl(input.value);
      busy = true;
      input.disabled = submit.disabled = true;
      await importVideo(url);
      close();
    } catch (e) {
      if (cancelling) close();
      else { error.hidden = false; error.textContent = e instanceof Error ? e.message : String(e); }
    } finally {
      busy = false;
      input.disabled = submit.disabled = false;
      if (overlay.isConnected) input.focus();
    }
  };
  submit.addEventListener('click', () => void start());
  cancel.addEventListener('click', () => void cancelAction());
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay && !busy) close(); });
  overlay.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); void cancelAction(); }
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (e.target === cancel) void cancelAction(); else void start(); }
    if (e.key === 'Tab') {
      const enabled = [input, cancel, submit].filter(node => !node.disabled);
      const first = enabled[0], last = enabled[enabled.length - 1];
      if (e.shiftKey && e.target === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && e.target === last) { e.preventDefault(); first?.focus(); }
    }
  });
  document.body.append(overlay);
  input.focus();
}
