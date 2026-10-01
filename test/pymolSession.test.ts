import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { unpackPymolSession } from '../src/main/pymolSession.js';

const plain = readFileSync(new URL('./fixtures/pymol/dna.pse', import.meta.url));
const compressed = readFileSync(new URL('./fixtures/pymol/dna-compressed.pse', import.meta.url));

describe('PyMOL compressed sessions', () => {
  it('unwraps the Python 3 protocol 1 envelope used by compressed PyMOL saves', () => {
    expect(unpackPymolSession(compressed)).toEqual(plain);
    expect(unpackPymolSession(plain)).toBe(plain);
  });

  it('supports Python 2 binary strings and Python 3 native byte strings', () => {
    const bytes = deflateSync(plain);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    for (const prefix of [Buffer.from('T'), Buffer.from([0x80, 3, 0x42])]) {
      expect(unpackPymolSession(Buffer.concat([prefix, length, bytes, Buffer.from('q\x00.')])))
        .toEqual(plain);
    }
  });

  it('rejects truncated, corrupt, and executable pickle envelopes without evaluating them', () => {
    expect(() => unpackPymolSession(compressed.subarray(0, 40))).toThrow();
    expect(() => unpackPymolSession(Buffer.from('cos\nsystem\n'))).toThrow();
    expect(() => unpackPymolSession(Buffer.from('U\x04oops.'))).toThrow('Could not decompress');
    expect(() => unpackPymolSession(Buffer.concat([compressed, Buffer.from('extra')]))).toThrow();
  });
});
