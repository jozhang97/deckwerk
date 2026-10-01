/** Checked compatibility changes for the pinned JSmol 16.4.23 runtime. */
export function patchPymolReader(source: string): string {
  // Keep the session's representations instead of the large-PDB wireframe preset.
  const before = 'this.asc.setInfo("noAutoBond",Boolean.TRUE);';
  if (source.split(before).length !== 2) throw new Error('JSmol PyMOL compatibility patch needs updating');
  return source.replace(before,
    'this.asc.setInfo("isPyMOL",Boolean.TRUE);this.asc.setInfo("noAutoBond",Boolean.TRUE);');
}

/** Molecular transparency is deliberately disabled for interactive performance.
 * Convert materials to opaque at import, avoiding the software renderer's second
 * pass entirely while preserving RGB colors and the original session bytes.
 */
export function patchPymolOpaqueRendering(source: string): string {
  const before = '"getTranslucentFlag",function(a){return 0==a?0:0>a?30720:Float.isNaN(a)||255<=a||1==a?16384:(w(Math.floor(1>a?256*a:15<=a?a:9>=a?w(Math.floor(a-1))<<5:256))>>5&15)<<11}';
  if (source.split(before).length !== 2) throw new Error('JSmol opaque rendering patch needs updating');
  return source.replace(before, '"getTranslucentFlag",function(a){return 0}');
}
