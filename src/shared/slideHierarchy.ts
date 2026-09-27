import type { Slide } from './deck.js';

/** Depth-first outline; presentation order remains the slides array order.
 * Clamp orphaned depths after an external delete/move rather than inventing
 * missing parents. Older decks have no depth and are entirely top-level. */
export function slideDepths(slides: readonly Slide[]): number[] {
  let previous = -1;
  return slides.map((slide) => {
    previous = Math.min(slide.depth ?? 0, previous + 1);
    return previous;
  });
}

export function subtreeEnd(depths: readonly number[], start: number): number {
  let end = start + 1;
  while (end < depths.length && depths[end] > depths[start]) end += 1;
  return end;
}

export function normalizeSlideDepths(slides: Slide[]): void {
  slideDepths(slides).forEach((depth, index) => {
    if (depth) slides[index].depth = depth;
    else delete slides[index].depth;
  });
}

/** Selected parents carry their descendants; overlapping selections shift once. */
export function changeSlideDepth(slides: Slide[], selected: ReadonlySet<string>, delta: 1 | -1): void {
  const depths = slideDepths(slides);
  const next = [...depths];
  for (let index = 0; index < slides.length; index += 1) {
    if (!selected.has(slides[index].id)) continue;
    const end = subtreeEnd(depths, index);
    const allowed = delta === 1
      ? index > 0 && depths[index] < next[index - 1] + 1
      : depths[index] > 0;
    if (allowed) {
      for (let child = index; child < end; child += 1) next[child] += delta;
    }
    index = end - 1;
  }
  if (next.every((depth, index) => depth === depths[index])) return;
  next.forEach((depth, index) => {
    if (depth) slides[index].depth = depth;
    else delete slides[index].depth;
  });
}

/** Delete exactly the selected slides, promoting children of removed parents. */
export function deleteSlidesPromotingChildren(slides: Slide[], selected: ReadonlySet<string>): Slide[] {
  const depths = slideDepths(slides);
  const removedParents: boolean[] = [];
  return slides.filter((slide, index) => {
    const depth = depths[index];
    removedParents.length = depth;
    const removed = selected.has(slide.id);
    const nextDepth = depth - removedParents.filter(Boolean).length;
    removedParents.push(removed);
    if (removed) return false;
    if (nextDepth) slide.depth = nextDepth;
    else delete slide.depth;
    return true;
  });
}

/** Move a complete branch to a boundary, adopting the target row's level. */
export function moveSlideBranch(slides: Slide[], from: number, target: number, after: boolean): number {
  normalizeSlideDepths(slides);
  const depths = slideDepths(slides);
  const end = subtreeEnd(depths, from);
  if (target >= from && target < end) return from;
  let to = after ? subtreeEnd(depths, target) : target;
  const targetDepth = depths[target];
  const branch = slides.splice(from, end - from);
  if (from < to) to -= branch.length;
  for (const slide of branch) slide.depth = (slide.depth ?? 0) + targetDepth - depths[from];
  slides.splice(to, 0, ...branch);
  normalizeSlideDepths(slides);
  return to;
}
