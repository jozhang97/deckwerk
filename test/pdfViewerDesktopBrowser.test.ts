import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck } from '../src/shared/deck.js';
import { Cdp, eventually, findTarget, stopBrowser } from './support/browserSession.js';
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';
import { pdfFixture } from './support/mediaFixtures.js';

let workDir = '';
let child: ChildProcess | null = null;
const sessions: Cdp[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await stopBrowser(child);
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

it('scrolls to the last page of a dropped PDF in the desktop editor and in Present', async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pdf-viewer-desktop-'));
  const deckDir = join(workDir, 'deck');
  const appDir = join(workDir, 'app');
  const profileDir = join(workDir, 'profile');
  const pdf = join(workDir, 'document.pdf');
  await mkdir(profileDir);
  await saveDeck(deckDir, emptyDeck('PDF viewer'));
  await writeFile(join(deckDir, 'theme.css'), '.slide { background: white; }');
  await writeFile(pdf, pdfFixture(3));
  await materializeDesktopApp(appDir, 'deckwerk-pdf-viewer-test');

  const app = await launchDesktopApp(appDir, [deckDir], { profileDir });
  child = app.process;
  const connect = async (url: string) => {
    const session = await Cdp.connect(url);
    sessions.push(session);
    return session;
  };
  const editorTarget = await findTarget(app.debugPort, isEditorTarget, app.log);
  const editor = await connect(editorTarget.webSocketDebuggerUrl!);
  const centerOf = (surface: Cdp, selector: string) => eventually(() => surface.evaluate<{ x: number; y: number } | null>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return box?.width && box.height ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  })()`), `${selector} is laid out`);
  const center = await centerOf(editor, '#canvas .slide');
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await editor.call('Input.dispatchDragEvent', {
      type, ...center, data: { items: [], files: [pdf], dragOperationsMask: 1 },
    });
  }
  const poster = '#canvas .web-body img[alt="document.pdf"]';
  await eventually(() => editor.evaluate(`document.querySelector(${JSON.stringify(poster)})?.naturalWidth > 0`), 'PDF first-page preview');
  await editor.doubleClick(poster);

  const scroll = async (surface: Cdp, targetId: string) => {
    const viewerTarget = await findTarget(app.debugPort,
      target => target.parentId === targetId && /\/assets\/web\/document\..+\.html$/.test(target.url), app.log);
    const viewer = await connect(viewerTarget.webSocketDebuggerUrl!);
    const frame = 'iframe.web-frame';
    await eventually(() => surface.evaluate(`(() => {
      const frame = document.querySelector('${frame}');
      return frame && getComputedStyle(frame).visibility === 'visible';
    })()`), 'PDF viewer painted');
    const pages = await viewer.evaluate<string[]>(`[...document.images].map(image => image.alt)`);
    expect(pages).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
    const point = (await centerOf(surface, frame))!;
    await viewer.evaluate(`(window.pointerMoves = 0, addEventListener('mousemove', () => window.pointerMoves++), null)`);
    await eventually(async () => {
      await viewer.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 1, y: point.y, button: 'none' });
      await viewer.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' });
      return viewer.evaluate<number>('window.pointerMoves');
    }, 'the embedded PDF receives pointer input');
    await eventually(async () => {
      await viewer.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel', ...point, deltaX: 0, deltaY: 360,
      });
      return viewer.evaluate(`(() => {
        const last = document.images[2];
        const box = last.getBoundingClientRect();
        return last.naturalWidth > 0 && box.top < innerHeight && box.bottom > 0;
      })()`);
    }, 'wheel scrolling revealed the last PDF page');
  };

  await scroll(editor, editorTarget.id!);
  await editor.clickByText('button', 'Present');
  const audienceTarget = await findTarget(app.debugPort, target => target.url.includes('/present/index.html'), app.log);
  await scroll(await connect(audienceTarget.webSocketDebuggerUrl!), audienceTarget.id!);
}, 120_000);
