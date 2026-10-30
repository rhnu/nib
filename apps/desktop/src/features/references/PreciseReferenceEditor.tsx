import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import type { ModelCapabilities, PreciseReferenceInput } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { trackPendingWork } from "../../shared/host/pending-work";
import { IconButton, Notice } from "../../shared/ui";
import { ImagePickerDialog } from "../media";
import { moveItem } from "../prompt/model";
import { referenceApi } from "./api";
import { patchPreciseReference, type PreciseReferenceIssues } from "./model";
import { PreciseReferenceAvailability, PreciseReferenceRow } from "./PreciseReferenceRow";
import "./references.css";

export interface PreciseReferenceEditorProps {
  value: PreciseReferenceInput[];
  onChange: (value: PreciseReferenceInput[]) => void;
  capabilities: ModelCapabilities | null;
  contextKey?: string | number;
  title?: string;
  issues?: PreciseReferenceIssues;
}

export function PreciseReferenceEditor({ contextKey, ...props }: PreciseReferenceEditorProps) {
  return <EditorContent key={contextKey} {...props} />;
}

function EditorContent({
  value,
  onChange,
  capabilities,
  title = "精确参考",
  issues,
}: Omit<PreciseReferenceEditorProps, "contextKey">) {
  const [pickingType, setPickingType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ active: true, locked: false, value, onChange });
  useLayoutEffect(() => {
    Object.assign(latest.current, { value, onChange });
  }, [value, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const update = (apply: (value: PreciseReferenceInput[]) => PreciseReferenceInput[]) => {
    const current = latest.current;
    if (!current.active) return;
    const next = apply(current.value);
    current.value = next;
    current.onChange(next);
  };

  async function add(assetId: string, referenceType: string) {
    const current = latest.current;
    if (current.locked) return;
    current.locked = true;
    setBusy(true);
    setError(null);
    try {
      await trackPendingWork(
        (async () => {
          const reference = await referenceApi.create(assetId, crypto.randomUUID(), referenceType);
          if (!current.active) return;
          // The pending operation includes this synchronous commit, not just the SDK response.
          update((value) => [...value, reference]);
        })(),
      );
    } catch (cause) {
      if (current.active) setError(errorMessage(cause));
    } finally {
      current.locked = false;
      if (current.active) setBusy(false);
    }
  }

  if (capabilities && !capabilities.canAddPreciseReference && !value.length) return null;

  return (
    <section className="precise-reference-editor" aria-label={title} aria-busy={busy}>
      <header className="precise-reference-heading">
        <h3>
          {title}
          {value.length > 0 ? ` · ${value.length}` : ""}
        </h3>
        <span className="spacer" />
        <IconButton
          label="添加精确参考图片"
          disabled={
            busy ||
            !capabilities?.canAddPreciseReference ||
            !capabilities.preciseReferenceOptions.referenceTypes.length
          }
          onClick={() =>
            setPickingType(capabilities?.preciseReferenceOptions.referenceTypes[0] ?? null)
          }
        >
          <ImagePlus size={14} />
        </IconButton>
      </header>
      <PreciseReferenceAvailability capabilities={capabilities} />
      {busy && <output className="precise-reference-status">正在准备精确参考…</output>}
      {error && <Notice>{error}</Notice>}
      {value.map((reference, index) => (
        <PreciseReferenceRow
          key={reference.id}
          value={reference}
          index={index}
          capabilities={capabilities}
          issues={issues?.[reference.id]}
          onChange={(patch) => update((value) => patchPreciseReference(value, reference.id, patch))}
          actions={
            <>
              <IconButton
                label={`上移精确参考 ${index + 1}`}
                disabled={index === 0}
                onClick={() =>
                  update((value) => {
                    const current = value.findIndex((item) => item.id === reference.id);
                    return current >= 0 ? moveItem(value, current, -1) : value;
                  })
                }
              >
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                label={`下移精确参考 ${index + 1}`}
                disabled={index === value.length - 1}
                onClick={() =>
                  update((value) => {
                    const current = value.findIndex((item) => item.id === reference.id);
                    return current >= 0 ? moveItem(value, current, 1) : value;
                  })
                }
              >
                <ArrowDown size={14} />
              </IconButton>
              <IconButton
                label={`移除精确参考 ${index + 1}`}
                onClick={() => update((value) => value.filter((item) => item.id !== reference.id))}
              >
                <Trash2 size={14} />
              </IconButton>
            </>
          }
        />
      ))}
      <ImagePickerDialog
        open={pickingType !== null}
        title="添加精确参考图片"
        onClose={() => setPickingType(null)}
        onSelect={(asset) => {
          if (pickingType !== null) void add(asset.id, pickingType);
        }}
      />
    </section>
  );
}
