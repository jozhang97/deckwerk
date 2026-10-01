import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { ImportedPymol } from '../shared/ipc.js';
import license from './vendor/jsmol/LICENSE.txt?raw';
import { MAX_PYMOL_SESSION_BYTES, unpackPymolSession } from './pymolSession.js';
import { pymolPage } from './pymolPage.js';

/** Validate in Chromium before offering the element; never insert a blank viewer. */
export async function importPymol(
  deckDir: string, sourcePath: string, progress: (message: string) => void,
): Promise<ImportedPymol> {
  if (extname(sourcePath).toLowerCase() !== '.pse') throw new Error('Choose a PyMOL session (.pse)');
  const title = basename(sourcePath);
  progress(`Reading ${title}`);
  if ((await stat(sourcePath)).size > MAX_PYMOL_SESSION_BYTES) throw new Error('PyMOL sessions must be smaller than 100 MB');
  const html = pymolPage(unpackPymolSession(await readFile(sourcePath)), title, license);
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
  const dir = join(deckDir, 'assets', 'web');
  await mkdir(dir, { recursive: true });
  const stem = `pymol-${hash}`;
  const temporary = join(dir, `${stem}.${randomUUID()}.html`);
  let window: BrowserWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await writeFile(temporary, html);
    progress(`Rendering ${title}`);
    window = new BrowserWindow({
      width: 1200, height: 800, useContentSize: true, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        offscreen: true, backgroundThrottling: false },
    });
    const preview = window;
    await Promise.race([
      (async () => {
        await preview.loadFile(temporary);
        const result = await preview.webContents.executeJavaScript(`new Promise((resolve) => {
          const poll = () => {
            if (document.body.dataset.pymolError) return resolve({error: document.body.dataset.pymolError});
            if (document.body.dataset.pymolReady) return requestAnimationFrame(() => requestAnimationFrame(() => resolve(
              document.body.dataset.pymolError ? {error: document.body.dataset.pymolError} : {ready:true})));
            setTimeout(poll, 50);
          }; poll();
        })`) as { error?: string; ready?: boolean };
        if (result.error) throw new Error(result.error);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out loading ${title}`)), 30_000);
      }),
    ]);
    progress(`Saving preview for ${title}`);
    const png = (await preview.webContents.capturePage()).toPNG();
    await writeFile(join(dir, `${stem}.png`), png);
    await rename(temporary, join(dir, `${stem}.html`));
    return { src: `assets/web/${stem}.html`, poster: `assets/web/${stem}.png`, title };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    throw new Error(message.trim() || `The molecular viewer failed while loading ${title}`);
  } finally {
    clearTimeout(timer);
    window?.destroy();
    await rm(temporary, { force: true });
  }
}
