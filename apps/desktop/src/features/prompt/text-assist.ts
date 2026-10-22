/** Textarea offsets use UTF-16, matching selectionStart and selectionEnd. */
export function insertAtSelection(text: string, start: number, end: number, insertion: string) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return {
    text: text.slice(0, from) + insertion + text.slice(to),
    caret: from + insertion.length,
  };
}

/** A request is current only while both its input and its sequence still match. */
export function isCurrentRequest(
  request: { key: string; sequence: number },
  current: { key: string; sequence: number; active: boolean },
) {
  return current.active && request.key === current.key && request.sequence === current.sequence;
}
