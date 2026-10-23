import { useState } from "react";
import type { ResultSummary } from "../../bindings/generation";
import type { VibeEncodingInput, VibeReferenceInput } from "../../bindings/workbench";
import { Button, Field } from "../../shared/ui";
import { VibeResultCard } from "./VibeResultCard";

export function VibeResults({
  results,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onAddReference,
  onEncode,
}: {
  results: ResultSummary[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => Promise<void>;
  onAddReference?: (reference: VibeReferenceInput) => void;
  onEncode?: (input: VibeEncodingInput) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = results.find((result) => result.id === selectedId) ?? results[0];
  return (
    <div className="vibe-results-view">
      <Field label="Vibe 编码结果">
        <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
          {results.map((result) => (
            <option key={result.id} value={result.id}>
              {new Date(result.createdAt).toLocaleString()} · #{result.jobId}
              {result.available ? "" : " · 不可用"}
            </option>
          ))}
        </select>
      </Field>
      {hasMore && (
        <Button disabled={loadingMore} onClick={() => void onLoadMore?.()}>
          {loadingMore ? "正在读取…" : "读取更早结果"}
        </Button>
      )}
      {selected && (
        <VibeResultCard
          key={selected.id}
          result={selected}
          onAddReference={onAddReference}
          onEncode={onEncode}
        />
      )}
    </div>
  );
}
