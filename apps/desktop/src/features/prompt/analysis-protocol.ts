import type { PromptContext, PromptDocument, PromptSyntaxProfile } from "@/bindings/prompt";

export type { PromptContext };

export type AnalysisRequest = {
  id: number;
  text: string;
  profile: PromptSyntaxProfile;
  context: PromptContext;
};

export type AnalysisResponse =
  | { id: number; document: PromptDocument }
  | { id: number; error: string };
