import { describe, expect, it } from "vitest";
import type { ExploreQuery } from "@/bindings/explore";
import {
  createExploreSession,
  effectiveExploreQuery,
  submitExploreQuery,
  updateExploreSource,
} from "./session";

describe("explore browsing context", () => {
  it("omits random filters from the request and keeps them available when leaving random", () => {
    const query: ExploreQuery = {
      source: "novelAi",
      sort: "random",
      period: "month",
      tags: ["scenery"],
      creatorId: "artist-a",
      randomSeed: null,
    };
    const request = effectiveExploreQuery(query);
    expect(request).toMatchObject({ sort: "random", tags: [], creatorId: null });
    expect(query.tags).toEqual(["scenery"]);
    expect(effectiveExploreQuery({ ...query, sort: "new" })).toMatchObject({
      tags: ["scenery"],
      creatorId: "artist-a",
    });
  });

  it("submits only the selected source and resets its browsing position without changing the other source", () => {
    const store = createExploreSession();
    updateExploreSource(store, "novelAi", (state) => ({ ...state, scroll: 450, basket: ["sky"] }));
    const savedNovelAi = store.getState().sources.novelAi;
    updateExploreSource(store, "danbooru", (state) => ({
      ...state,
      query: { source: "danbooru", tags: "cat -dog", ratings: ["general"] },
      scroll: 300,
      basket: ["cat"],
    }));
    submitExploreQuery(store, "danbooru");
    expect(store.getState().sources.danbooru.applied).toEqual({
      source: "danbooru",
      tags: "cat -dog",
      ratings: ["general"],
    });
    expect(store.getState().sources.danbooru.scroll).toBe(0);
    expect(store.getState().sources.danbooru.basket).toEqual(["cat"]);
    expect(store.getState().sources.novelAi).toBe(savedNovelAi);
  });
});
