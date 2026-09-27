import { resolveKeynoteSidecar, runImporterSidecar } from './keynoteImport.js';

/** The shipped Keynote sidecar already includes MuPDF. Reuse it to turn PDF
 * figures into ordinary SVG assets, which render in every slide surface. */
export async function convertPdfToSvg(
  source: string,
  destination: string,
): Promise<{ width: number; height: number }> {
  const sidecar = resolveKeynoteSidecar();
  if (!sidecar) throw new Error('PDF converter not found. Run npm run setup:importer in development.');
  const { stdout } = await runImporterSidecar('PDF', sidecar.command, [
    ...sidecar.args, source, '--pdf-figure', '--out', destination,
  ]);
  const result = JSON.parse(stdout) as { width: number; height: number };
  if (!Number.isFinite(result.width) || result.width <= 0
    || !Number.isFinite(result.height) || result.height <= 0) {
    throw new Error('PDF converter returned invalid page dimensions.');
  }
  return { width: result.width, height: result.height };
}
