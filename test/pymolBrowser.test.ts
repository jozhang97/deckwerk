import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck } from '../src/shared/deck.js';
import { Cdp, eventually, findTarget, stopBrowser, wait } from './support/browserSession.js';
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';

async function connect(url: string): Promise<Cdp> {
  const cdp = await Cdp.connect(url);
  const call = cdp.call.bind(cdp);
  cdp.call = (method, params = {}, timeout = 10_000) => call(method, params, timeout);
  return cdp;
}

async function keyReplacingFrame(host: Cdp, key: string, code: number, settled: () => Promise<boolean>): Promise<void> {
  // Chromium can destroy the focused child before acknowledging keyDown.
  // Assert the observable transition, then release the key in the host.
  const pressed = host.call('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code: key, windowsVirtualKeyCode: code,
  }, 2000).catch(() => {});
  await eventually(settled, `${key} must leave the focused frame`);
  await host.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  await pressed;
}

let work = '';
let process: ChildProcess | null = null;
const clients: Cdp[] = [];
const observers: WebSocket[] = [];
afterEach(async () => {
  observers.splice(0).forEach(o => o.close());
  clients.splice(0).forEach(c => c.close());
  await stopBrowser(process);
  process = null;
  if (work) await rm(work, { recursive: true, force: true });
});

it('imports a PSE through the toolbar, previews it, and rotates/zooms offline in the sandbox', { timeout: 120_000 }, async () => {
  work = await mkdtemp(join(tmpdir(), 'deckwerk-pymol-'));
  const deckDir = join(work, 'deck');
  const appDir = join(work, 'app');
  const profileDir = join(work, 'profile');
  await mkdir(profileDir);
  const deck = emptyDeck('Molecule test');
  deck.slides.push({ ...structuredClone(deck.slides[0]), id: 'next-slide' });
  await saveDeck(deckDir, deck);
  await writeFile(join(deckDir, 'theme.css'), '.slide { background:white }');
  const bad = join(work, 'invalid.pse');
  await writeFile(bad, 'not a PyMOL session');
  const sessionFile = globalThis.process.env.PYMOL_TEST_SESSION_FILE || resolve('test/fixtures/pymol/cartoon-opacity.pse');
  const dialogs = join(work, 'dialogs.json');
  await writeFile(dialogs, JSON.stringify([
    { canceled: true },
    { filePaths: [sessionFile] },
    { filePaths: [bad] },
  ]));
  await materializeDesktopApp(appDir, 'deckwerk-pymol-test');
  const app = await launchDesktopApp(appDir, [deckDir], { profileDir, env: { DECKWERK_TEST_DIALOGS: dialogs } });
  process = app.process;
  const target = await findTarget(app.debugPort, isEditorTarget, app.log);
  const editor = await connect(target.webSocketDebuggerUrl!);
  clients.push(editor);
  await eventually(() => editor.evaluate(`Boolean(document.querySelector('#canvas .slide')) && [...document.querySelectorAll('button')].some(b => b.textContent === 'PyMOL…' && b.getBoundingClientRect().width > 0)`), 'editor ready');
  // As in webImageDropBrowser: let the desktop startup watcher broadcast
  // settle before editing, so it cannot replace this fixture mid-operation.
  await wait(4000);
  await editor.click('#pymol-import-trigger');
  await eventually(() => readFile(dialogs, 'utf8'), 'cancellation consumed', s => JSON.parse(s).length === 2);
  expect(await editor.evaluate(`document.querySelectorAll('#canvas [data-element-id]').length`)).toBe(0);
  await eventually(() => editor.evaluate(`!document.getElementById('pymol-import-trigger').disabled`), 'import dialog closed');
  await editor.click('#pymol-import-trigger');
  await eventually(() => editor.evaluate<string>(`document.getElementById('status').textContent`),
    'session imported', text => text.includes(`Embedded ${basename(sessionFile)}`), 40_000);
  const media = await editor.evaluate<{ src: string; poster: string; id: string }>(`(() => {
    const el = document.querySelector('#canvas [data-element-id]');
    const img = el.querySelector('img');
    return {id: el.dataset.elementId, poster: img.src, src: img.src.replace(/\.png$/, '.html')};
  })()`);
  expect(media.poster).toContain('pymol-');
  expect(await editor.evaluate(`document.querySelector('#canvas [data-element-id] img').naturalWidth > 0`)).toBe(true);
  const modifier = globalThis.process.platform === 'darwin' ? 4 : 2;
  await editor.chord('z', 'KeyZ', 90, modifier);
  await eventually(() => editor.evaluate(`document.querySelectorAll('#canvas [data-element-id]').length`), 'undo removes import', n => n === 0);
  await editor.chord('z', 'KeyZ', 90, modifier | 8);
  await eventually(() => editor.evaluate(`document.querySelectorAll('#canvas [data-element-id]').length`), 'redo restores import', n => n === 1);

  // Preview stays inert until the user explicitly interacts.
  await editor.doubleClick(`#canvas [data-element-id="${media.id}"]`);
  const embedded = await findTarget(app.debugPort, t => t.url.includes('assets/web/pymol-') && t.url.endsWith('.html'), app.log);
  const editorPage = await connect(embedded.webSocketDebuggerUrl!);
  clients.push(editorPage);
  await eventually(() => editorPage.evaluate(`document.body.dataset.pymolReady === 'true'`), 'editor molecule ready');
  expect(await editor.evaluate(`document.querySelector('#canvas iframe').getAttribute('sandbox')`)).toBe('allow-scripts');
  const diagnostic = await editorPage.evaluate<string>(`(() => {
    window.pymolFailed(null, 'reader', 'Load failed: data:application/octet-stream;base64,' + 'A'.repeat(100000));
    return document.body.dataset.pymolError;
  })()`);
  expect(diagnostic).toBe('Load failed: [embedded session]');
  await keyReplacingFrame(editor, 'Escape', 27, () => editor.evaluate(`!document.querySelector('#canvas iframe')`));

  editorPage.close();
  // Finish the pending autosave before attaching to the audience frame: a
  // deck broadcast replaces that frame and invalidates its DevTools target.
  await eventually(() => editor.evaluate(`!document.getElementById('status').textContent.includes('unsaved')`), 'autosave finished');
  await editor.clickByText('button', 'Present');
  const audienceTarget = await findTarget(app.debugPort, t => t.url.includes('/present/index.html'), app.log);
  const audience = await connect(audienceTarget.webSocketDebuggerUrl!);
  clients.push(audience);
  const playing = await findTarget(app.debugPort, t => t.url.includes('assets/web/pymol-') && t.url.endsWith('.html') && t.webSocketDebuggerUrl !== embedded.webSocketDebuggerUrl, app.log);
  const page = await connect(playing.webSocketDebuggerUrl!);
  clients.push(page);
  const observer = new WebSocket(playing.webSocketDebuggerUrl!);
  await new Promise<void>(resolve => observer.once('open', resolve));
  const pageErrors: string[] = [];
  observer.on('message', raw => {
    const event = JSON.parse(String(raw));
    if (event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')) pageErrors.push(JSON.stringify(event.params));
  });
  observer.send(JSON.stringify({id:1,method:'Runtime.enable'}));
  observers.push(observer);
  await audience.call('Network.enable');
  await audience.call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await eventually(() => page.evaluate(`document.body.dataset.pymolReady === 'true'`), 'molecule ready');
  expect(await page.evaluate(`Number(Jmol.evaluateVar(molecule, '{*}.count'))`)).toBeGreaterThan(100);
  expect(await audience.evaluate(`document.querySelector('iframe').getAttribute('sandbox')`)).toBe('allow-scripts');
  if (!globalThis.process.env.PYMOL_TEST_SESSION_FILE) {
    const appearance = await page.evaluate<{cartoons:number;opaque:number;translucent:number;bonds:number;levels:number[]}>(`(() => {
      const v = molecule._applet.viewer;
      const cartoons = (v.shm.shapes[11]?.bioShapes || []).flatMap(s =>
        Array.from(s.mads).slice(0, s.monomerCount).flatMap((mad, i) => mad > 0 ? [s.colixes[i]] : []));
      return {cartoons:cartoons.length, opaque:cartoons.filter(c => !JU.C.isColixTranslucent(c)).length,
        translucent:cartoons.filter(c => JU.C.isColixTranslucent(c)).length,
        bonds:v.ms.bo.filter(b => b && b.mad > 0).length,
        levels:cartoons.filter(c => JU.C.isColixTranslucent(c)).map(c => JU.C.getColixTranslucencyFractional(c))};
    })()`);
    expect(appearance.cartoons).toBe(40);
    expect(appearance.opaque).toBe(40);
    expect(appearance.translucent).toBe(0);
    expect(appearance.bonds).toBe(0);
    expect(appearance.levels).toEqual([]);
    expect(await page.evaluate(`molecule._applet.viewer.gdata.haveTranslucentObjects()`)).toBe(false);
  }


  // Seeded gesture walk: each drag/wheel must change the molecular view while
  // preserving the slide element and its session. Exercises both directions.
  let seed = 19;
  const next = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
  const restingQuality = await page.evaluate(`JSON.stringify([
    molecule._applet.viewer.g.antialiasDisplay, molecule._applet.viewer.g.cartoonFancy,
    molecule._applet.viewer.g.hermiteLevel, molecule._canvas.width, molecule._canvas.height])`);
  const center = await audience.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await page.evaluate(`(window.pointerMoves = 0, addEventListener('mousemove', () => window.pointerMoves++, true), null)`);
  await eventually(async () => {
    await page.call('Input.dispatchMouseEvent', {type:'mouseMoved',x:center.x+1,y:center.y,button:'none'});
    await page.call('Input.dispatchMouseEvent', {type:'mouseMoved',x:center.x,y:center.y,button:'none'});
    return page.evaluate<number>('window.pointerMoves');
  }, 'frame is receiving pointer input', n => n > 0);
  for (let i = 0; i < 6; i++) {
    await wait(150);
    const before = await page.evaluate<string>(`Jmol.getPropertyAsJSON(molecule, 'orientationInfo')`);
    if (i % 2 === 0) {
      const drag = await page.beginDrag(center.x, center.y);
      if (i === 0) await wait(300); // Holding still must not restore detail mid-drag.
      expect(await page.evaluate(`document.body.dataset.pymolMoving`)).toBe('true');
      expect(await page.evaluate(`molecule._applet.viewer.g.antialiasDisplay`)).toBe(false);
      expect(await page.evaluate(`molecule._canvas.width === document.getElementById('viewer').clientWidth`)).toBe(true);
      await drag.moveTo(center.x + 40 + next() * 50, center.y + next() * 40);
      await drag.drop();
    } else {
      await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y, button: 'none' });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y,
        deltaX: 0, deltaY: next() > 0.5 ? 100 : -100 });
    }
    await eventually(() => page.evaluate<string>(`Jmol.getPropertyAsJSON(molecule, 'orientationInfo')`),
      `gesture ${i} changes orientation or zoom`, value => value !== before);
  }
  await eventually(() => page.evaluate(`!document.body.dataset.pymolMoving`), 'detail restored after gestures');
  expect(await page.evaluate(`JSON.stringify([
    molecule._applet.viewer.g.antialiasDisplay, molecule._applet.viewer.g.cartoonFancy,
    molecule._applet.viewer.g.hermiteLevel, molecule._canvas.width, molecule._canvas.height])`)).toBe(restingQuality);
  await page.evaluate(`(() => {
    const v = molecule._applet.viewer, original = v.zoomByFactor;
    window.zoomFactors = [];
    v.zoomByFactor = function(f,x,y) { window.zoomFactors.push(f); return original.call(this,f,x,y); };
    for (let i=0;i<10;i++) document.getElementById('viewer').dispatchEvent(
      new WheelEvent('wheel',{deltaY:10,bubbles:true,cancelable:true}));
  })()`);
  await eventually(() => page.evaluate<number>(`window.zoomFactors.length`), 'wheel burst applied once', n => n === 1);
  expect(await page.evaluate<number>(`window.zoomFactors[0]`)).toBeCloseTo(Math.exp(-0.1), 8);
  await page.evaluate(`window.dispatchEvent(new Event('blur'))`);
  expect(await page.evaluate(`document.body.dataset.pymolMoving`)).toBeUndefined();
  expect(await page.evaluate(`JSON.stringify([
    molecule._applet.viewer.g.antialiasDisplay, molecule._applet.viewer.g.cartoonFancy,
    molecule._applet.viewer.g.hermiteLevel, molecule._canvas.width, molecule._canvas.height])`)).toBe(restingQuality);
  expect(await page.evaluate(`molecule._canvas.width === document.getElementById('viewer').clientWidth`)).toBe(true);
  expect(await page.evaluate(`document.body.dataset.pymolError ?? ''`)).toBe('');
  expect(pageErrors).toEqual([]);
  expect(await audience.evaluate(`document.querySelector('.stage [data-slide-id]')?.dataset.slideId`)).toBe(deck.slides[0].id);
  await keyReplacingFrame(audience, 'ArrowRight', 39, () => audience.evaluate(
    `document.querySelector('.stage [data-slide-id]')?.dataset.slideId === 'next-slide'`));
  await audience.evaluate('window.close()').catch(() => {});

  await editor.click('#pymol-import-trigger');
  await eventually(() => editor.evaluate<string>(`document.getElementById('status').textContent`),
    'invalid session rejected', text => text.includes('PyMOL import failed:'), 40_000);
  expect(await editor.evaluate(`document.querySelectorAll('#canvas [data-element-id]').length`)).toBe(1);
  expect(await editor.evaluate(`document.getElementById('status').dataset.busy`)).toBe('false');

  const dropFile = globalThis.process.env.PYMOL_TEST_DROP_FILE || resolve('test/fixtures/pymol/dna-compressed.pse');
  const dropPoint = await editor.evaluate<{x: number; y: number}>(`(() => { const r = document.querySelector('#canvas .slide').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await editor.call('Input.dispatchDragEvent', { type, ...dropPoint,
      data: { items: [], files: [dropFile], dragOperationsMask: 1 } });
  }
  await eventually(() => editor.evaluate<{count: number; status: string}>(`({count:document.querySelectorAll('#canvas .slide [data-element-id]').length,status:document.getElementById('status').textContent})`),
    'dropping a PSE embeds another interactive molecule', value => value.count === 2, 40_000);
  expect(await editor.evaluate(`document.getElementById('status').textContent`)).toContain(`Embedded ${basename(dropFile)}`);
  await editor.chord('z', 'KeyZ', 90, modifier);
  await eventually(() => editor.evaluate(`document.querySelectorAll('#canvas .slide [data-element-id]').length`),
    'undo removes the dropped session', n => n === 1);
});
