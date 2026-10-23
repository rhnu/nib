import { useState } from "react";
import type { GenerationResult } from "../../bindings/generation";
import type { VibeEncodingInput, VibeReferenceInput } from "../../bindings/workbench";
import { Field } from "../../shared/ui";
import { VibeResultCard } from "./VibeResultCard";

export function VibeResults({
  results,
  onAddReference,
  onEncode,
}: {
  results: GenerationResult[];
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
