export type GenerationViewState = {
  view: "source" | "results" | "live";
  resultKind: "image" | "vibe";
  selectedResultId: string | null;
  liveJobId: string | null;
  liveSampleIndex: number;
};

export const initialGenerationViewState: GenerationViewState = {
  view: "results",
  resultKind: "image",
  selectedResultId: null,
  liveJobId: null,
  liveSampleIndex: 0,
};
