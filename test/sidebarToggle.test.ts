// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createSidebarToggle } from '../src/renderer/editor/sidebarToggle.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="body"><aside id="side"><input></aside></div>';
});

function setup() {
  const body = document.getElementById('body')!;
  const side = document.getElementById('side')!;
  const button = createSidebarToggle(body, side);
  document.body.prepend(button);
  return { body, side, button };
}

describe('right sidebar visibility', () => {
  it('defaults to visible and can always be reopened', () => {
    const { body, button } = setup();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(body.classList.contains('sidebar-collapsed')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Show right sidebar');
    button.click();
    expect(body.classList.contains('sidebar-collapsed')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Hide right sidebar');
  });

  it('remembers visibility when the toolbar is rebuilt without losing the sidebar width', () => {
    const { body, button } = setup();
    body.style.setProperty('--sidebar-width', '410px');
    button.click();
    button.remove();
    const rebuilt = setup().button;
    expect(rebuilt.getAttribute('aria-pressed')).toBe('false');
    rebuilt.click();
    expect(body.style.getPropertyValue('--sidebar-width')).toBe('410px');
  });

  it('blurs inspector fields before hiding and restores their DOM intact', () => {
    const { side, button } = setup();
    const input = side.querySelector('input')!;
    input.focus();
    input.value = 'Edited';
    let blurred = false;
    input.addEventListener('blur', () => { blurred = true; });
    button.click();
    expect(blurred).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click();
    expect(side.querySelector('input')).toBe(input);
    expect(input.value).toBe('Edited');
  });
});
