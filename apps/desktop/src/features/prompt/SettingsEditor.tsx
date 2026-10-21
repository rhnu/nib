import { RotateCcw } from "lucide-react";
import type { GenerationSettings, ResolvedSettings } from "../../bindings/workbench";
import { Field, IconButton } from "../../shared/ui";

export function SettingsEditor({
  value,
  onChange,
  models,
  resolved,
  compact = false,
}: {
  value: GenerationSettings;
  onChange: (value: GenerationSettings) => void;
  models: string[];
  resolved?: ResolvedSettings;
  compact?: boolean;
}) {
  const number = (raw: string): number | null =>
    raw.trim() === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
  return (
    <div className={`settings-fields ${compact ? "settings-compact" : ""}`}>
      <Field label="模型" className="full">
        <select
          value={value.model ?? ""}
          onChange={(event) => onChange({ ...value, model: event.target.value || null })}
        >
          <option value="">继承{resolved ? ` · ${resolved.model}` : ""}</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </Field>
      <div className="field full">
        <span>尺寸</span>
        <div className="size-inputs">
          <input
            aria-label="宽度"
            type="number"
            placeholder={resolved ? String(resolved.size.width) : "继承宽度"}
            value={value.size?.width ?? ""}
            onChange={(event) => {
              const width = number(event.target.value);
              onChange({
                ...value,
                size:
                  width === null
                    ? null
                    : { width, height: value.size?.height ?? resolved?.size.height ?? width },
              });
            }}
          />
          <span>×</span>
          <input
            aria-label="高度"
            type="number"
            placeholder={resolved ? String(resolved.size.height) : "继承高度"}
            value={value.size?.height ?? ""}
            onChange={(event) => {
              const height = number(event.target.value);
              onChange({
                ...value,
                size:
                  height === null
                    ? null
                    : { height, width: value.size?.width ?? resolved?.size.width ?? height },
              });
            }}
          />
          <IconButton
            label="恢复继承尺寸"
            disabled={value.size === null}
            onClick={() => onChange({ ...value, size: null })}
          >
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </div>
      {(
        [
          ["steps", "Steps"],
          ["scale", "Guidance"],
        ] as const
      ).map(([key, label]) => (
        <Field label={label} key={key}>
          <input
            type="number"
            step="any"
            value={value[key] ?? ""}
            placeholder={resolved ? String(resolved[key]) : "继承"}
            onChange={(event) => onChange({ ...value, [key]: number(event.target.value) })}
          />
        </Field>
      ))}
      <Field label="采样器" className="full">
        <input
          value={value.sampler ?? ""}
          placeholder={resolved?.sampler ?? "继承"}
          onChange={(event) => onChange({ ...value, sampler: event.target.value || null })}
        />
      </Field>
    </div>
  );
}
