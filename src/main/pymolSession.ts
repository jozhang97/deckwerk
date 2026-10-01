import { inflateSync } from 'node:zlib';

export const MAX_PYMOL_SESSION_BYTES = 100 * 1024 * 1024;

/** Decode only PyMOL's byte-string compression envelope, never execute pickle. */
export function unpackPymolSession(input: Buffer): Buffer {
  if (input.length > MAX_PYMOL_SESSION_BYTES) throw new Error('PyMOL sessions must be smaller than 100 MB');
  let offset = 0;
  const malformed = () => new Error('Unsupported or damaged compressed PyMOL session');
  function take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > input.length) throw malformed();
    const value = input.subarray(offset, offset + length);
    offset += length;
    return value;
  }
  function expect(value: string): void {
    if (!take(value.length).equals(Buffer.from(value, 'latin1'))) throw malformed();
  }
  function memo(): void {
    if (input[offset] === 0x71) take(2); // BINPUT
    else if (input[offset] === 0x72) take(5); // LONG_BINPUT
    else if (input[offset] === 0x94) take(1); // MEMOIZE
  }
  function string(): Buffer {
    const op = take(1)[0];
    const length = op === 0x55 || op === 0x43 ? take(1)[0]
      : op === 0x54 || op === 0x42 || op === 0x58 ? take(4).readUInt32LE() : -1;
    const value = take(length);
    if (op !== 0x58) return value;
    // Python 3 protocol 1/2 encodes bytes as _codecs.encode(unicode, 'latin1').
    const unicode = new TextDecoder('utf-8', { fatal: true }).decode(value);
    for (const char of unicode) if (char.charCodeAt(0) > 255) throw malformed();
    return Buffer.from(unicode, 'latin1');
  }
  if (input[0] === 0x80) {
    if (input[1] > 3) throw new Error('Unsupported PyMOL session serialization version');
    take(2);
  }
  // Uncompressed dictionary pickles are read directly by JSmol.
  if (input[offset] === 0x7d || (input[offset] === 0x28 && input[offset + 1] === 0x64)) return input;
  let compressed: Buffer;
  if (input[offset] === 0x63) {
    expect('c_codecs\nencode\n'); memo();
    const marked = input[offset] === 0x28;
    if (marked) take(1);
    compressed = string(); memo();
    if (string().toString('ascii') !== 'latin1') throw malformed();
    memo(); expect(marked ? 't' : '\x86'); memo(); expect('R'); memo();
  } else if ([0x54, 0x55, 0x42, 0x43].includes(input[offset])) {
    compressed = string(); memo();
  } else {
    throw new Error('This file is not a readable PyMOL session');
  }
  expect('.');
  if (offset !== input.length) throw malformed();
  try {
    return inflateSync(compressed, { maxOutputLength: MAX_PYMOL_SESSION_BYTES });
  } catch {
    throw new Error('Could not decompress PyMOL session: damaged data or expanded size exceeds 100 MB');
  }
}
