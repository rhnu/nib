import { useEffect, useRef } from "react";
import type { CharacterComposition, ModelCapabilities } from "../../bindings/workbench";
import { LocateFixed, RotateCcw } from "lucide-react";
import { Button, Field, HelpMarker, IconButton } from "../../shared/ui";
import "./characters.css";
import type { CharacterFieldIssue } from "./model";

export function CharacterPositionPolicy({
  value,
  onChange,
  inherited,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  inherited?: boolean | null;
}) {
  return (
    <div className="character-position-policy" data-setting-field="useCoords">
      <Field label="角色位置">
        <select
          value={value === null ? "inherit" : String(value)}
          onChange={(event) =>
            onChange(event.target.value === "inherit" ? null : event.target.value === "true")
          }
        >
          <option value="inherit">
            继承
            {inherited === true ? " · 使用坐标" : inherited === false ? " · 自动" : " · 按角色位置"}
          </option>
          <option value="false">自动</option>
          <option value="true">使用坐标</option>
        </select>
      </Field>
      <HelpMarker label="角色位置方式">
        自动由模型安排位置，保留已编辑坐标；使用坐标时由 SDK 适配当前模型。未声明时继续继承。
      </HelpMarker>
    </div>
  );
}

export function CharacterPositionFields({
  value,
  onChange,
  capabilities,
  onPosition,
  onRestore,
  overridden,
  issues = [],
}: {
  value: CharacterComposition["position"];
  onChange: (position: CharacterComposition["position"]) => void;
  capabilities: ModelCapabilities | null;
  onPosition?: () => void;
  onRestore?: () => void;
  overridden?: boolean;
  issues?: CharacterFieldIssue[];
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const signature = issues
    .filter((issue) => issue.field === "x" || issue.field === "y")
    .map((issue) => `${issue.field}:${issue.message}`)
    .join("|");
  useEffect(() => {
    if (signature && details.current) details.current.open = true;
  }, [signature]);
  const options = capabilities?.characterPositionOptions;
  const grid = options?.gridCoordinates;
  return (
    <details className="character-position-fields" ref={details}>
      <summary>位置{overridden && <span className="tag">本次覆盖</span>}</summary>
      <div className="character-position-controls">
        {(["x", "y"] as const).map((axis) => (
          <Field key={axis} label={axis.toUpperCase()}>
            {grid ? (
              <select
                aria-invalid={issues.some((issue) => issue.field === axis) || undefined}
                data-character-field={axis}
                value={value[axis]}
                onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) })}
              >
                {!grid.includes(value[axis]) && (
                  <option value={value[axis]}>当前 {value[axis]}</option>
                )}
                {grid.map((coordinate) => (
                  <option key={coordinate} value={coordinate}>
                    {coordinate}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-invalid={issues.some((issue) => issue.field === axis) || undefined}
                data-character-field={axis}
                type="number"
                step="any"
                min={options?.range.min}
                max={options?.range.max}
                value={value[axis]}
                onWheel={(event) => event.currentTarget.blur()}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber))
                    onChange({ ...value, [axis]: event.currentTarget.valueAsNumber });
                }}
              />
            )}
          </Field>
        ))}
        {options && (
          <IconButton label="居中角色位置" onClick={() => onChange({ ...options.defaultPosition })}>
            <LocateFixed size={14} />
          </IconButton>
        )}
        {onRestore && (
          <IconButton label="撤销角色位置覆盖" disabled={!overridden} onClick={onRestore}>
            <RotateCcw size={14} />
          </IconButton>
        )}
        {onPosition && (
          <Button disabled={!capabilities?.characterPositioning} onClick={onPosition}>
            在画布定位
          </Button>
        )}
      </div>
    </details>
  );
}
