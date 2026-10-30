import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import type { ResultSummary } from "@/bindings/generation";

export type ResultSelection =
  | { kind: "job"; id: string }
  | { kind: "result"; result: ResultSummary; backJob?: string }
  | { kind: "source" };

type ResultViewState = {
  selection: ResultSelection | null;
  sourceReturn: ResultSelection | null;
  seenBatch: string | null;
};

/** Selection belongs to the generation session, independently for preview and gallery. */
function createResultView() {
  return createStore<ResultViewState>(() => ({
    selection: null,
    sourceReturn: null,
    seenBatch: null,
  }));
}

const ResultViewsContext = createContext<{
  preview: ReturnType<typeof createResultView>;
  gallery: ReturnType<typeof createResultView>;
} | null>(null);

export function ResultViewsProvider({ children }: { children: ReactNode }) {
  const [views] = useState(() => ({ preview: createResultView(), gallery: createResultView() }));
  return <ResultViewsContext value={views}>{children}</ResultViewsContext>;
}

export function useResultViewStore(gallery: boolean) {
  const views = useContext(ResultViewsContext);
  if (!views) throw new Error("图片视图缺少生成会话状态。");
  return gallery ? views.gallery : views.preview;
}
