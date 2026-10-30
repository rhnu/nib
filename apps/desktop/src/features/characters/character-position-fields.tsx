import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useRef } from "react";
import type { CharacterComposition, ModelCapabilities } from "@/bindings/workbench";
import { LocateFixed, RotateCcw } from "lucide-react";
import { Button, Field, HelpMarker, IconButton } from "@/shared/ui";
import "./characters.css";
import type { CharacterFieldIssue } from "./model";

export function CharacterPositionPolicy({
  value,
  onChange,
  inherited,
  onPosition,
  disabled = false,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  inherited?: boolean | null;
  onPosition?: () => void;
  disabled?: boolean;
}) {
  useTranslation();

  const effective = value ?? inherited;
  return (
    <div className="character-position-policy" data-setting-field="useCoords">
      <fieldset className="character-position-options" aria-label={t("characters.positionTitle")}>
        <button type="button" aria-pressed={effective === false} onClick={() => onChange(false)}>
          {t("characters.aiChoice")}
        </button>
        <button type="button" aria-pressed={effective === true} onClick={() => onChange(true)}>
          {t("characters.custom")}
        </button>
      </fieldset>
      {onPosition && (
        <IconButton
          label={t("characters.positionOnCanvas")}
          disabled={disabled}
          onClick={onPosition}
        >
          <LocateFixed size={14} />
        </IconButton>
      )}
      <span className="spacer" />
      <IconButton
        label={t("characters.resetPositionMode")}
        disabled={value === null}
        onClick={() => onChange(null)}
      >
        <RotateCcw size={14} />
      </IconButton>
      <HelpMarker label={t("characters.positionMode")}>{t("characters.positionHelp")}</HelpMarker>
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
  useTranslation();

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
      <summary>
        {t("characters.position")}
        {overridden && <span className="tag">{t("characters.currentOverride")}</span>}
      </summary>
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
                  <option value={value[axis]}>
                    {t("characters.currentValue")}
                    {value[axis]}
                  </option>
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
          <IconButton
            label={t("characters.center")}
            onClick={() => onChange({ ...options.defaultPosition })}
          >
            <LocateFixed size={14} />
          </IconButton>
        )}
        {onRestore && (
          <IconButton
            label={t("characters.resetPosition")}
            disabled={!overridden}
            onClick={onRestore}
          >
            <RotateCcw size={14} />
          </IconButton>
        )}
        {onPosition && (
          <Button disabled={!capabilities?.characterPositioning} onClick={onPosition}>
            {t("characters.placeOnCanvas")}
          </Button>
        )}
      </div>
    </details>
  );
}
