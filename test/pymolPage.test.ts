import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pymolPage } from '../src/main/pymolPage.js';

describe('portable PyMOL page', () => {
  it('embeds binary session bytes and escapes filenames and license text', () => {
    const bytes = Uint8Array.from([0, 255, 128, 60, 47, 115, 99]);
    const title = '</title><script>window.bad=true</script>"';
    const html = pymolPage(bytes, title, 'license </script><script>bad()</script>');
    const dom = new JSDOM(html);
    expect(dom.window.document.title).toBe(title);
    expect(dom.window.document.querySelector('#viewer')?.getAttribute('aria-label')).toBe(title);
    expect(html).toContain(Buffer.from(bytes).toString('base64'));
    expect(dom.window.document.querySelectorAll('script[src], link, iframe')).toHaveLength(0);
    expect(dom.window.document.querySelectorAll('script')).toHaveLength(4);
    expect(JSON.parse(dom.window.document.getElementById('jsmol-license')!.textContent!))
      .toBe('license </script><script>bad()</script>');
    expect(dom.window.document.querySelector('script[data-deckwerk-bridge]')).not.toBeNull();
    expect(dom.window.document.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain("connect-src 'none'");
    dom.window.close();
  });
});
