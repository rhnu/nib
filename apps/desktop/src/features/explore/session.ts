import { createStore } from "zustand/vanilla";
import type { ExploreQuery, ExploreSource, ExploreSummary } from "@/bindings/explore";

export type ExploreBrowseState = {
  query: ExploreQuery;
  applied: ExploreQuery;
  selected: ExploreSummary | null;
  basket: string[];
  scroll: number;
  revision: number;
};

/** Random browsing retains the editable filters while omitting them from its request. */
export function effectiveExploreQuery(query: ExploreQuery): ExploreQuery {
  return query.source === "novelAi" && query.sort === "random"
    ? { ...query, tags: [], creatorId: null }
    : query;
}

function initial(query: ExploreQuery): ExploreBrowseState {
  return {
    query,
    applied: effectiveExploreQuery(query),
    selected: null,
    basket: [],
    scroll: 0,
    revision: 0,
  };
}

/** Browser context survives route changes; each source owns its filters, selection and scroll. */
export function createExploreSession() {
  return createStore<{
    source: ExploreSource;
    sources: Record<ExploreSource, ExploreBrowseState>;
  }>(() => ({
    source: "danbooru",
    sources: {
      danbooru: initial({ source: "danbooru", tags: "", ratings: ["general", "sensitive"] }),
      novelAi: initial({
        source: "novelAi",
        sort: "new",
        period: "week",
        tags: [],
        creatorId: null,
        randomSeed: null,
      }),
    },
  }));
}

export type ExploreSession = ReturnType<typeof createExploreSession>;

export function updateExploreSource(
  store: ExploreSession,
  source: ExploreSource,
  update: (state: ExploreBrowseState) => ExploreBrowseState,
) {
  store.setState((state) => ({
    sources: { ...state.sources, [source]: update(state.sources[source]) },
  }));
}

export function submitExploreQuery(store: ExploreSession, source: ExploreSource) {
  updateExploreSource(store, source, (state) => ({
    ...state,
    applied: effectiveExploreQuery(state.query),
    selected: null,
    scroll: 0,
    revision: state.revision + 1,
  }));
}
