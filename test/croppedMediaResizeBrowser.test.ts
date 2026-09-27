import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { electronBinary } from './support/browserSession.js';
import { IMAGE, MOD, startCrossSession, type CrossSession } from './support/crossContextSession.js';

let session: CrossSession;
let close: (() => Promise<void>) | null = null;
beforeAll(async () => {
  const started = await startCrossSession('crop-resize', 'Cropped media resizing');
  session = started.session;
  close = started.close;
}, 180_000);
afterAll(async () => { await close?.(); });

interface MediaBox {
  w: number;
  h: number;
  sourceBox: { x: number; y: number; w: number; h: number };
}

async function prepare(fit: 'contain' | 'cover' | 'fill'): Promise<void> {
  await session.reset();
  await session.cdp.evaluate(`(() => {
    window.canvas.toggleMaskMode(null);
    window.store.commit(deck => {
      const image = deck.slides[0].elements.find(element => element.id === '${IMAGE}');
      Object.assign(image, {
        x: 600, y: 400, w: 400, h: 200, fit: '${fit}',
        sourceBox: { x: -80, y: -40, w: 800, h: 400 }
      });
    }, { history: false });
  })()`);
  await session.click(IMAGE);
}

const read = () => session.cdp.evaluate<MediaBox>(
  `window.store.get().deck.slides[0].elements.find(element => element.id === '${IMAGE}')`,
);

async function resize(): Promise<void> {
  const handle = await session.boxOf(`.handle-se[data-element-id="${IMAGE}"]`);
  const x = handle.left + handle.width / 2;
  const y = handle.top + handle.height / 2;
  await session.dragPath([{ x, y }, { x: x + 60, y: y + 5 }]);
}

describe.skipIf(!electronBinary)('resizing cropped media', () => {
  it.each(['contain', 'cover'] as const)('keeps the crop and picture proportional with fit %s', async (fit) => {
    await prepare(fit);
    const before = await read();
    // Regression: the checkbox was on, but having a sourceBox bypassed it.
    await resize();
    const after = await read();
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.w / after.h).toBeCloseTo(2, 2);
    expect(after.sourceBox.w / after.sourceBox.h).toBeCloseTo(2, 2);
    expect(after.sourceBox.x / after.w).toBeCloseTo(-0.2, 2);
    expect(after.sourceBox.y / after.h).toBeCloseTo(-0.2, 2);
    await session.chord('z', 'KeyZ', 90, MOD);
    expect(await read()).toEqual(before);
    await session.chord('z', 'KeyZ', 90, MOD | 8);
    expect(await read()).toEqual(after);
  });

  it('still allows stretching with Keep aspect ratio off', async () => {
    await prepare('fill');
    await resize();
    const after = await read();
    expect(after.w / after.h).toBeGreaterThan(2.2);
  });

  it('allows changing the crop window while keeping the underlying picture fixed', async () => {
    await prepare('contain');
    await session.cdp.evaluate(`window.canvas.toggleMaskMode('${IMAGE}')`);
    await resize();
    const after = await read();
    expect(after.w / after.h).toBeGreaterThan(2.2);
    expect(after.sourceBox).toEqual({ x: -80, y: -40, w: 800, h: 400 });
  });
});
