import { describe, expect, it } from "vitest";
import { refreshHistory, type HistoryPage } from "./paged-history";

type Item = { id: string };

function items(from: number, to: number): Item[] {
  return Array.from({ length: from - to + 1 }, (_, index) => ({ id: String(from - index) }));
}

describe("catching up paged history", () => {
  it("recovers more than one page of new records after older history was exhausted", async () => {
    const previous = { items: items(100, 1), nextCursor: null };
    const requested: string[] = [];
    const refreshed = await refreshHistory(
      { items: items(220, 171), nextCursor: "171" },
      previous,
      async (before) => {
        requested.push(before);
        return before === "171"
          ? { items: items(170, 121), nextCursor: "121" }
          : { items: items(120, 71), nextCursor: "71" };
      },
      () => true,
    );
    expect(requested).toEqual(["171", "121"]);
    expect(refreshed.items).toEqual(items(220, 1));
    expect(refreshed.nextCursor).toBeNull();
  });
  it("fills a jumped head while retaining the cursor for unread older records", async () => {
    const previous = { items: items(100, 51), nextCursor: "51" };
    const refreshed = await refreshHistory(
      { items: items(160, 111), nextCursor: "111" },
      previous,
      async () => ({ items: items(110, 61), nextCursor: "61" }),
      () => true,
    );
    expect(refreshed.items).toEqual(items(160, 51));
    expect(refreshed.nextCursor).toBe("51");
  });
  it("does not load another page when the refreshed head already reaches known history", async () => {
    const previous = { items: items(100, 51), nextCursor: "51" };
    const refreshed = await refreshHistory(
      { items: items(110, 61), nextCursor: "61" },
      previous,
      async (): Promise<HistoryPage<Item>> => {
        throw new Error("unexpected history read");
      },
      () => true,
    );
    expect(refreshed.items).toEqual(items(110, 51));
    expect(refreshed.nextCursor).toBe("51");
  });
  it("keeps an initial load bounded and catches up from a previously empty history", async () => {
    const head = { items: items(60, 11), nextCursor: "11" };
    expect(
      await refreshHistory(
        head,
        null,
        async () => {
          throw new Error("unexpected initial read");
        },
        () => true,
      ),
    ).toBe(head);
    const refreshed = await refreshHistory(
      head,
      { items: [], nextCursor: null },
      async () => ({ items: items(10, 1), nextCursor: null }),
      () => true,
    );
    expect(refreshed.items).toEqual(items(60, 1));
    expect(refreshed.nextCursor).toBeNull();
  });
  it("updates known head records without pulling unread older records across the boundary", async () => {
    const previous = {
      items: [
        { id: "3", available: true },
        { id: "2", available: true },
      ],
      nextCursor: "2",
    };
    const refreshed = await refreshHistory(
      {
        items: [
          { id: "3", available: false },
          { id: "2", available: false },
          { id: "1", available: true },
        ],
        nextCursor: null,
      },
      previous,
      async () => {
        throw new Error("unexpected extra page");
      },
      () => true,
    );
    expect(refreshed.items).toEqual([
      { id: "3", available: false },
      { id: "2", available: false },
    ]);
    expect(refreshed.nextCursor).toBe("2");
  });
  it("stops gap reads after the owning request becomes obsolete", async () => {
    let current = true;
    const requested: string[] = [];
    await refreshHistory(
      { items: items(220, 171), nextCursor: "171" },
      { items: items(100, 51), nextCursor: "51" },
      async (before) => {
        requested.push(before);
        current = false;
        return { items: items(170, 121), nextCursor: "121" };
      },
      () => current,
    );
    expect(requested).toEqual(["171"]);
  });
});
