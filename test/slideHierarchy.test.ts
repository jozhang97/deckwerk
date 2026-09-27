import { describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type Slide } from '../src/shared/deck.js';
import { changeSlideDepth, deleteSlidesPromotingChildren, moveSlideBranch, slideDepths } from '../src/shared/slideHierarchy.js';
import { diffDecks } from '../src/shared/deckDiff.js';
import { applyOpsLenient } from '../src/shared/collabApply.js';

function slides(depths: number[]): Slide[] {
  return depths.map((depth, index) => ({
    ...emptyDeck().slides[0], id: `s${index}`, depth,
  }));
}

describe('slide outline operations', () => {
  it('does not mutate an explicit root depth when indentation cannot change', () => {
    const branch = slides([0]);
    changeSlideDepth(branch, new Set(['s0']), 1);
    expect(branch[0].depth).toBe(0);
  });

  it('promotes surviving children when their parent is deleted', () => {
    const branch = slides([0, 1, 0, 1, 2, 1]);
    const remaining = deleteSlidesPromotingChildren(branch, new Set(['s2']));
    expect(remaining.map((slide) => slide.id)).toEqual(['s0', 's1', 's3', 's4', 's5']);
    expect(slideDepths(remaining)).toEqual([0, 1, 0, 1, 0]);
  });

  it('shifts whole subtrees once even when children are selected too', () => {
    const branch = slides([0, 0, 1, 2, 0]);
    changeSlideDepth(branch, new Set(['s1', 's2']), 1);
    expect(slideDepths(branch)).toEqual([0, 1, 2, 3, 0]);
    changeSlideDepth(branch, new Set(['s1', 's2']), -1);
    expect(slideDepths(branch)).toEqual([0, 0, 1, 2, 0]);
  });

  it('moves a parent and descendants together, after the target branch', () => {
    const branch = slides([0, 1, 2, 0, 1]);
    expect(moveSlideBranch(branch, 0, 3, true)).toBe(2);
    expect(branch.map((slide) => slide.id)).toEqual(['s3', 's4', 's0', 's1', 's2']);
    expect(slideDepths(branch)).toEqual([0, 1, 0, 1, 2]);
  });

  it('does not move a parent into itself', () => {
    const branch = slides([0, 1, 2, 0]);
    expect(moveSlideBranch(branch, 0, 2, true)).toBe(0);
    expect(branch.map((slide) => slide.id)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('adopts the destination depth when moving a child to the top level', () => {
    const branch = slides([0, 1, 2, 0]);
    expect(moveSlideBranch(branch, 1, 3, true)).toBe(2);
    expect(branch.map((slide) => slide.id)).toEqual(['s0', 's3', 's1', 's2']);
    expect(slideDepths(branch)).toEqual([0, 0, 0, 1]);
  });

  it('handles old decks and orphaned levels after external structural edits', () => {
    expect(slideDepths(emptyDeck().slides)).toEqual([0]);
    expect(slideDepths(slides([3, 5, 0, 4]))).toEqual([0, 1, 0, 1]);
  });

  it('preserves depth in collaboration patches and clears it on undo', () => {
    const before = parseDeck({ ...emptyDeck(), slides: slides([0, 0]) });
    const after = structuredClone(before);
    changeSlideDepth(after.slides, new Set(['s1']), 1);
    const forward = applyOpsLenient(before, diffDecks(before, after));
    expect(forward.skipped).toEqual([]);
    expect(forward.deck).toEqual(after);
    expect(applyOpsLenient(after, diffDecks(after, before)).deck).toEqual(before);
  });
});
