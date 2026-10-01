import { expect, it } from 'vitest';
import { websiteUrl } from '../src/shared/website.js';
it('normalizes web addresses and rejects privileged schemes and credentials', () => {
  expect(websiteUrl(' example.com/path?q=1 ')).toBe('https://example.com/path?q=1');
  expect(websiteUrl('http://localhost:8080/')).toBe('http://localhost:8080/');
  for (const input of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'deck://asset', 'https://user:password@example.com']) {
    expect(() => websiteUrl(input)).toThrow();
  }
});
