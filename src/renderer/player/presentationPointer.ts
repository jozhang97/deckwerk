/**
 * A click produced after dragging across text must belong to the browser's
 * native selection gesture, not to presentation navigation.
 */
export function selectionPreventsAdvance(selection: Selection | null = window.getSelection()): boolean {
  return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed;
}

/** Native media controls own pointer and keyboard gestures, including shadow-DOM controls. */
export function eventOnMediaControls(event: Event): boolean {
  return event.composedPath().some(target => target instanceof HTMLMediaElement && target.controls)
    || (event.target instanceof HTMLMediaElement && event.target.controls);
}
