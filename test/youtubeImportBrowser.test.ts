import { execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { emptyDeck } from '../src/shared/deck.js';
import { saveDeck } from '../src/main/deckStore.js';
import { getFfmpegPath } from '../src/main/ffmpeg.js';
import { Cdp, eventually, findTarget, stopBrowser } from './support/browserSession.js';
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';
let work = '';
let child: ChildProcess | null = null;
let cdp: Cdp | null = null;
afterEach(async () => { cdp?.close(); await stopBrowser(child); if (work) await rm(work, { recursive: true, force: true }); });

it('downloads into the deck, plays offline, undoes, and handles invalid input, failure and cancellation', { timeout: 180_000 }, async () => {
  work = await mkdtemp(join(tmpdir(), 'deckwerk-youtube-test-'));
  const deckDir = join(work, 'deck'), appDir = join(work, 'app'), profileDir = join(work, 'profile');
  await mkdir(profileDir);
  const deck = emptyDeck('YouTube');
  deck.slides.push({ ...structuredClone(deck.slides[0]), id: 'next-slide' });
  await saveDeck(deckDir, deck);
  await writeFile(join(deckDir, 'theme.css'), '');
  const fixture = join(work, 'fixture.mp4');
  await promisify(execFile)(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
  // Only the external network boundary is substituted. IPC, importer, ffprobe,
  // file copying, rendering, progress and undo are the real desktop app.
  const downloader = join(work, 'yt-dlp');
  const runs = join(work, 'runs.txt');
  await writeFile(downloader, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2), url = args.at(-1);
const output = path.dirname(args[args.indexOf('-o') + 1]);
fs.appendFileSync(${JSON.stringify(runs)}, output + '\\n');
if (url.includes('bbbbbbbbbbb')) { console.error('Video unavailable'); process.exit(1); }
console.log('DW_PROGRESS 5 10');
if (url.includes('aaaaaaaaaaa')) setInterval(() => {}, 1000);
else setTimeout(() => { fs.copyFileSync(${JSON.stringify(fixture)}, path.join(output, 'Example [jNQXAC9IVRw].mp4')); console.log('DW_PROCESS'); }, 1500);
`, { mode: 0o755 });
  await materializeDesktopApp(appDir, 'deckwerk-youtube-test');
  const app = await launchDesktopApp(appDir, [deckDir], { profileDir, env: { DECKWERK_YTDLP_PATH: downloader } });
  child = app.process;
  const target = await findTarget(app.debugPort, isEditorTarget, app.log);
  cdp = await Cdp.connect(target.webSocketDebuggerUrl!);
  const editor = cdp;
  await eventually(() => editor.evaluate(`Boolean(document.querySelector('#canvas .slide')) && document.querySelector('.bar-deck-name')?.title === ${JSON.stringify(deckDir)}`), 'editor ready');
  const open = async () => {
    await editor.evaluate(`[...document.querySelectorAll('.toolbar-expanded-file-actions button')].find(b => b.textContent === 'Import…').click()`);
    await editor.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'YouTube video…').click()`);
  };
  const submit = async (url: string) => {
    await editor.evaluate(`document.querySelector('.workflow-dialog input').value = ${JSON.stringify(url)}`);
    await editor.click('[data-submit]', 'download');
  };
  // A repeatable dialog interaction walk checks invalid entries and Escape do
  // not leak Enter/Delete shortcuts into the slide behind the modal.
  for (const invalid of ['not a URL', 'https://example.com/video', 'https://youtube.com/playlist?list=x']) {
    await open(); await submit(invalid);
    expect(await editor.evaluate(`!document.querySelector('#youtube-error').hidden`)).toBe(true);
    await editor.chord('Escape', 'Escape', 27, 0);
    expect(await editor.evaluate(`document.querySelectorAll('#canvas video').length`)).toBe(0);
  }
  await open(); await submit('https://youtu.be/jNQXAC9IVRw');
  await eventually(() => editor.evaluate(`document.querySelector('#status').dataset.busy === 'true'`), 'delayed activity indicator');
  await eventually(() => editor.evaluate(`!document.querySelector('#youtube-dialog-title') && !!document.querySelector('#canvas video')`), 'video added');
  expect(await editor.evaluate(`document.querySelector('#status').dataset.busy`)).toBe('false');
  await eventually(() => editor.evaluate(`document.querySelector('#canvas video').readyState >= 2`), 'local video decodes');
  await eventually(() => editor.evaluate(`window.api.getDeck().then(s => s.deck.slides[0].elements.some(e => e.type === 'video'))`), 'saved video');
  const session = await editor.evaluate<{ deck: { slides: { elements: { src: string; type: string }[] }[] } }>('window.api.getDeck()');
  const video = session.deck.slides[0].elements.find(e => e.type === 'video')!;
  expect(video.src).toMatch(/^assets\/.*\.mp4$/);
  expect((await readFile(join(deckDir, video.src))).length).toBeGreaterThan(100);
  const mod = process.platform === 'darwin' ? 4 : 2;
  await editor.chord('z', 'KeyZ', 90, mod);
  await eventually(() => editor.evaluate(`document.querySelectorAll('#canvas video').length === 0`), 'undo');
  await editor.chord('z', 'KeyZ', 90, mod | 8);
  await eventually(() => editor.evaluate(`document.querySelectorAll('#canvas video').length === 1`), 'redo');
  await editor.clickByText('button', 'Present');
  const audience = await findTarget(app.debugPort, t => t.url.includes('/present/index.html'), app.log);
  const player = await Cdp.connect(audience.webSocketDebuggerUrl!);
  try {
    await eventually(() => player.evaluate(`document.querySelector('video')?.readyState >= 2`), 'presentation video loaded');
    const box = await player.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
      const r = document.querySelector('video').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    })()`);
    // Real mouse input, not video.play(): the control must own this gesture.
    await player.clickAt(box.x - box.width / 2 + 24, box.y + box.height / 2 - 48);
    await eventually(() => player.evaluate(`document.querySelector('video')?.currentTime > 0.4 && !document.querySelector('video').paused`), 'native play control starts video');
    await player.clickAt(box.x - box.width / 2 + 24, box.y + box.height / 2 - 48);
    await eventually(() => player.evaluate(`document.querySelector('video')?.paused`), 'native pause control pauses video');
    await player.click('video');
    expect(await player.evaluate(`!!document.querySelector('video')`)).toBe(true);
    expect(await player.evaluate(`getComputedStyle(document.querySelector('video')).cursor`)).toBe('auto');
    await player.clickAt(20, 20);
    await eventually(() => player.evaluate(`!document.querySelector('video')`), 'click outside video still advances');
    // Escape destroys this window, so its CDP response may lose the race to teardown.
    await player.chord('Escape', 'Escape', 27, 0).catch(error => {
      if (!(error instanceof Error) || error.message !== 'Electron DevTools connection closed') throw error;
    });
    await eventually(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${app.debugPort}/json/list`)).json() as { id: string }[];
      return !targets.some(target => target.id === audience.id);
    }, 'Escape closed the presentation');
  } finally { player.close(); }
  await open(); await submit('https://youtu.be/bbbbbbbbbbb');
  await eventually(() => editor.evaluate(`document.querySelector('#youtube-error').textContent.includes('Video unavailable')`), 'failure');
  await editor.click('[data-cancel]', 'close error');
  await open(); await submit('https://youtu.be/aaaaaaaaaaa');
  await eventually(() => editor.evaluate(`document.querySelector('#status').dataset.busy === 'true'`), 'download running');
  await editor.click('[data-cancel]', 'cancel download');
  await eventually(() => editor.evaluate(`!document.querySelector('#youtube-dialog-title')`), 'cancel finished');
  expect(await editor.evaluate(`document.querySelector('#status').dataset.busy`)).toBe('false');
  expect(await editor.evaluate(`document.querySelectorAll('#canvas video').length`)).toBe(1);
  const paths = (await readFile(runs, 'utf8')).trim().split('\n');
  for (const path of paths) await expect(readdir(path)).rejects.toThrow();
});
