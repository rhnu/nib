import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PromptDocument } from "@/bindings/prompt";
import { errorMessage } from "@/shared/host/error";
import { promptApi } from "./api";
import { registerPromptAnalysis } from "./analysis-runtime";
import type { PromptContext } from "./analysis-protocol";

/** Analysis is keyed to the exact source, context and SDK model profile, never retained as current. */
export function usePromptAnalysis(
  text: string,
  model: string | undefined,
  context: PromptContext,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const profile = useQuery({
    queryKey: ["prompt-syntax", model ?? null],
    queryFn: () => promptApi.syntax(model),
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const client = useRef<ReturnType<typeof registerPromptAnalysis> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([text, model, context, profile.data, attempt]);
  const [result, setResult] = useState<{
    key: string;
    document?: PromptDocument;
    error?: Error;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const registered = registerPromptAnalysis();
    client.current = registered;
    return () => {
      registered.dispose();
      client.current = null;
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !profile.data) return;
    let current = true;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      cancel = client.current?.analyze({ text, profile: profile.data!, context }, (value) => {
        if (current) {
          setResult(value instanceof Error ? { key, error: value } : { key, document: value });
        }
      });
    }, 0);
    return () => {
      current = false;
      clearTimeout(timer);
      cancel?.();
    };
  }, [context, enabled, key, profile.data, text]);
  const current = enabled && result?.key === key ? result : null;
  const error = enabled ? (profile.error ?? current?.error) : null;
  return {
    profile: profile.data,
    document: current?.document ?? null,
    pending: enabled && !error && !current?.document,
    error: error ? errorMessage(error) : "",
    retry: () => {
      if (!enabled) return;
      if (profile.isError) void profile.refetch();
      else setAttempt((value) => value + 1);
    },
  };
}
