import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ModelCapabilities, VibeReferenceInput } from "../../bindings/workbench";
import { FormField, HelpMarker, IconButton } from "../../shared/ui";
import { preciseReferenceMessages } from "../references/model";
import { VibeReferenceRow } from "./VibeReferenceRow";
import { VibeMaterialDialog } from "./VibeMaterialDialog";
import { referenceMode, type VibeIssues } from "./model";
import "./vibes.css";

export function VibeNormalize({
  value,
  inherited,
  onChange,
}: {
  value: boolean | null;
  inherited?: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  const id = useId();
  return (
    <FormField
      className="vibe-normalize"
      label="强度归一化"
      htmlFor={id}
      help={<HelpMarker label="归一化说明">对整个 Vibe 集合的编码强度进行归一化。</HelpMarker>}
    >
      <select
        id={id}
        className={value === null ? "inherited-control" : undefined}
        value={value === null ? "inherit" : String(value)}
        onChange={(event) => onChange(referenceMode(event.currentTarget.value))}
      >
        <option value="inherit">
          {inherited == null ? "默认" : inherited ? "开启" : "关闭"} · 继承
        </option>
        <option value="true">开启</option>
        <option value="false">关闭</option>
      </select>
    </FormField>
  );
}

export interface VibeReferenceEditorProps {
  value: VibeReferenceInput[];
  onChange: (value: VibeReferenceInput[]) => void;
  capabilities: ModelCapabilities | null;
  contextKey?: string | number;
  normalizeValue?: boolean | null;
  onNormalizeChange?: (value: boolean | null) => void;
  issues?: VibeIssues;
}
export function VibeReferenceEditor({ contextKey, ...props }: VibeReferenceEditorProps) {
  return <Editor key={contextKey} {...props} />;
}
function Editor({
  value,
  onChange,
  capabilities,
  normalizeValue = null,
  onNormalizeChange,
  issues,
}: Omit<VibeReferenceEditorProps, "contextKey">) {
  const [materials, setMaterials] = useState(false);
  const latest = useRef({ value, onChange });
  useLayoutEffect(() => {
    Object.assign(latest.current, { value, onChange });
  }, [value, onChange]);
  const update = (next: VibeReferenceInput[]) => {
    latest.current.value = next;
    latest.current.onChange(next);
  };
  const move = (index: number, delta: number) => {
    const next = [...latest.current.value];
    const item = next[index];
    if (!item || !next[index + delta]) return;
    next.splice(index, 1);
    next.splice(index + delta, 0, item);
    update(next);
  };
  const message = capabilities ? preciseReferenceMessages(capabilities).vibe : null;
  return (
    <section className="vibe-editor" aria-label="Vibe 参考">
      <header className="vibe-heading">
        <h3>Vibe{value.length ? ` · ${value.length}` : ""}</h3>
        <span className="spacer" />
        <IconButton label="打开 Vibe 材料" onClick={() => setMaterials(true)}>
          <Plus size={14} />
        </IconButton>
      </header>
      {onNormalizeChange &&
        (value.length > 0 || normalizeValue !== null || capabilities?.vibeInputPath) && (
          <div data-vibe-field="normalizeStrength">
            <VibeNormalize
              value={normalizeValue}
              inherited={capabilities?.vibeReferenceOptions.normalizeStrengthDefault}
              onChange={onNormalizeChange}
            />
          </div>
        )}
      {message && <p className="vibe-message">{message}</p>}
      {value.map((reference, index) => (
        <VibeReferenceRow
          key={reference.id}
          value={reference}
          index={index}
          capabilities={capabilities}
          issues={issues?.[reference.id]}
          onChange={(patch) =>
            update(
              latest.current.value.map((item) =>
                item.id === reference.id ? { ...item, ...patch } : item,
              ),
            )
          }
          actions={
            <>
              <IconButton
                label={`上移 Vibe ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={13} />
              </IconButton>
              <IconButton
                label={`下移 Vibe ${index + 1}`}
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </IconButton>
              <IconButton
                label={`移除 Vibe ${index + 1}`}
                onClick={() =>
                  update(latest.current.value.filter((item) => item.id !== reference.id))
                }
              >
                <Trash2 size={13} />
              </IconButton>
            </>
          }
        />
      ))}
      <VibeMaterialDialog
        open={materials}
        capabilities={capabilities}
        onClose={() => setMaterials(false)}
        onSelect={(selected, mode) => {
          update(mode === "replace" ? selected : [...latest.current.value, ...selected]);
          setMaterials(false);
        }}
      />
    </section>
  );
}
