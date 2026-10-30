import { mergeSummaries } from "./summary";

export type HistoryPage<T> = { items: T[]; nextCursor: string | null };

/** Catch up to the previous head without changing the cursor for unread older history. */
export async function refreshHistory<T extends { id: string }>(
  head: HistoryPage<T>,
  previous: HistoryPage<T> | null,
  loadPage: (before: string) => Promise<HistoryPage<T>>,
  isCurrent: () => boolean,
): Promise<HistoryPage<T>> {
  if (previous === null) return head;
  const known = new Set(previous.items.map((item) => item.id));
  const discovered: T[] = [];
  let page = head;
  while (isCurrent()) {
    const boundary = page.items.findIndex((item) => known.has(item.id));
    discovered.push(
      ...(boundary < 0
        ? page.items
        : page.items.filter((item, index) => index < boundary || known.has(item.id))),
    );
    if (boundary >= 0 || page.nextCursor === null) break;
    page = await loadPage(page.nextCursor);
  }
  return { items: mergeSummaries(discovered, previous.items), nextCursor: previous.nextCursor };
}
