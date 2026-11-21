import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportedAsset } from '@shared/ipc.js';
import { WEB_BRIDGE_MARKER, WEB_BRIDGE_RUNTIME } from '@shared/webBridge.js';
import { resolveKeynoteSidecar, runImporterSidecar } from './keynoteImport.js';

const VIEWER_START = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF document</title>
<script ${WEB_BRIDGE_MARKER}>${WEB_BRIDGE_RUNTIME}</script>
<style>
  html, body { height: 100%; margin: 0; }
  main { height: 100%; overflow-y: auto; overscroll-behavior: contain; color-scheme: light dark; background: Canvas; }
  img { display: block; width: 100%; height: auto; background: white; }
  img + img { margin-top: 12px; }
</style></head><body><main aria-label="PDF pages" tabindex="0">`;
const VIEWER_END = `</main><script>
  const pages = document.querySelector('main');
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const offsets = {
      ArrowUp: -48,
      ArrowDown: 48,
      PageUp: -pages.clientHeight * 0.9,
      PageDown: pages.clientHeight * 0.9,
    };
    const offset = offsets[event.key];
    if (typeof offset !== 'number') return;
    event.preventDefault();
    pages.scrollBy(0, offset);
  });
</script></body></html>`;
const VIEWER_VERSION = createHash('sha256').update(VIEWER_START).update(VIEWER_END).digest('hex').slice(0, 8);

/** The Keynote sidecar already ships with MuPDF. It writes a vector first-page
 * preview and streams the pages into a sandboxed, self-contained web asset. */
export async function convertPdf(
  source: string,
  destination: string,
  viewer: { assetsDir: string; stem: string; hash: string; title: string },
  onProgress?: (ratio: number | null, message?: string) => void,
): Promise<Pick<ImportedAsset, 'width' | 'height' | 'pdfViewer'>> {
  const sidecar = resolveKeynoteSidecar();
  if (!sidecar) throw new Error('PDF converter not found. Run npm run setup:importers in development.');
  const webDir = join(viewer.assetsDir, 'web');
  const name = `${viewer.stem}.${viewer.hash}.pdf-${VIEWER_VERSION}.html`;
  const target = join(webDir, name);
  const temporary = existsSync(target) ? null : join(viewer.assetsDir, `${randomUUID()}.partial`);
  try {
    if (temporary) await writeFile(temporary, VIEWER_START, { encoding: 'utf8', flag: 'wx' });
    const { stdout } = await runImporterSidecar('PDF', sidecar.command, [
      ...sidecar.args, source, '--pdf-figure', '--out', destination,
      ...(temporary ? ['--pdf-viewer', temporary] : []),
    ], (message, ratio) => onProgress?.(ratio, message));
    const { width, height, pageCount } = JSON.parse(stdout) as { width: number; height: number; pageCount: number };
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
      || !Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new Error('PDF converter returned invalid page information.');
    }
    if (pageCount === 1) return { width, height };

    if (temporary) {
      await mkdir(webDir, { recursive: true });
      await appendFile(temporary, VIEWER_END, 'utf8');
      await rename(temporary, target);
    }
    return { width, height, pdfViewer: { src: `assets/web/${name}`, title: viewer.title } };
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}
