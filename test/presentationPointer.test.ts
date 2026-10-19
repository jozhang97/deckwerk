// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { bindPresentKeys } from '../src/renderer/player/keys.js';
import { eventOnMediaControls, selectionPreventsAdvance } from '../src/renderer/player/presentationPointer.js';

describe('presentation pointer navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="copy">Select these words</p>';
    window.getSelection()?.removeAllRanges();
  });

  it('lets an ordinary click advance', () => {
    expect(selectionPreventsAdvance()).toBe(false);
  });

  it('keeps the slide in place after selecting text with the mouse', () => {
    const text = document.getElementById('copy')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    const selection = window.getSelection()!;
    selection.addRange(range);

    expect(selection.toString()).toBe('Select');
    expect(selectionPreventsAdvance()).toBe(true);
  });

  it('does not suppress navigation for a collapsed caret', () => {
    const text = document.getElementById('copy')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    window.getSelection()!.addRange(range);

    expect(selectionPreventsAdvance()).toBe(false);
  });
});


describe('interactive video controls', () => {
  it('reserves native and shadow-root media gestures, but not ordinary slide clicks', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    video.controls = true;
    root.append(video); document.body.append(host);
    let interactive = false;
    host.addEventListener('click', e => { interactive = eventOnMediaControls(e); });
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(interactive).toBe(true);
    video.controls = false;
    video.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(interactive).toBe(false);
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(interactive).toBe(false);
    host.remove();
  });

  it('leaves Space and arrows to focused video controls while Escape still exits', () => {
    const video = document.createElement('video'); video.controls = true; document.body.append(video);
    let next = 0, prev = 0, exits = 0;
    const unbind = bindPresentKeys(window, {} as never, {
      onNext: () => { next++; }, onPrev: () => { prev++; }, onExit: () => { exits++; },
    });
    for (const key of [' ', 'ArrowRight', 'ArrowLeft']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      video.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect([next, prev]).toEqual([0, 0]);
    video.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(exits).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(next).toBe(1);
    unbind(); video.remove();
  });
});
