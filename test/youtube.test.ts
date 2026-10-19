// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { youtubeUrl } from '../src/shared/youtube.js';
import { showYoutubeDialog } from '../src/renderer/editor/youtubeDialog.js';
afterEach(() => document.body.replaceChildren());
it.each([
  'https://youtu.be/jNQXAC9IVRw?t=10',
  'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=ignored',
  'https://m.youtube.com/shorts/jNQXAC9IVRw',
  'https://youtube.com/embed/jNQXAC9IVRw',
])('canonicalizes %s into one video', url => {
  expect(youtubeUrl(url)).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw');
});
it.each(['https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'file:///etc/passwd', '--exec=foo',
  'https://youtube.com/playlist?list=x', 'https://user:pass@youtube.com/watch?v=jNQXAC9IVRw',
  'https://youtube.com/watch?v=../../x', 'https://youtu.be/jNQXAC9IVRw/extra'])('rejects %s', url => {
  expect(() => youtubeUrl(url)).toThrow();
});
it('keeps invalid input local and restores focus on cancellation', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const run = vi.fn(); showYoutubeDialog(run, vi.fn());
  document.querySelector<HTMLInputElement>('input')!.value = 'not a video';
  document.querySelector<HTMLButtonElement>('[data-submit]')!.click();
  expect(run).not.toHaveBeenCalled();
  expect(document.querySelector('#youtube-error')?.textContent).toContain('YouTube');
  document.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
  expect(document.querySelector('.workflow-overlay')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('prevents duplicate submissions and cancels the running import', async () => {
  let reject!: (e: Error) => void;
  const run = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
  const cancel = vi.fn(async () => { reject(new Error('cancelled')); });
  showYoutubeDialog(run, cancel);
  document.querySelector<HTMLInputElement>('input')!.value = 'https://youtu.be/jNQXAC9IVRw';
  const submit = document.querySelector<HTMLButtonElement>('[data-submit]')!;
  submit.click(); submit.click(); expect(run).toHaveBeenCalledTimes(1);
  document.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
  await vi.waitFor(() => expect(document.querySelector('.workflow-overlay')).toBeNull());
  expect(cancel).toHaveBeenCalledTimes(1);
});
