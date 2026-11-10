import { Row, Input, Button, Field, HelpMarker, IconButton, Select } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useRef } from "react";
import type { CharacterComposition, ModelCapabilities } from "@/bindings/workbench";
import { LocateFixed, RotateCcw } from "lucide-react";

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
    <Row
      gap={0}
      className="character-position-policy [&_>_.ui-field]:flex-1 flex items-center gap-space-2 m-[8px_0]"
      data-setting-field="useCoords"
    >
      <Row
        align="stretch"
        as="fieldset"
        gap={0}
        className="character-position-options [&_button]:min-h-[28px] [&_button]:p-[4px_9px] [&_button]:text-caption [&_button]:[border:0] [&_button]:bg-panel [&_button_+_button]:[border-left:1px_solid_var(--line)] [&_button[aria-pressed='true']]:bg-accent-soft [&_button[aria-pressed='true']]:text-accent flex p-0 m-0 [border:1px_solid_var(--line)] rounded-control overflow-hidden"
        aria-label={t("characters.positionTitle")}
      >
        <Button type="button" aria-pressed={effective === false} onClick={() => onChange(false)}>
          {t("characters.aiChoice")}
        </Button>
        <Button type="button" aria-pressed={effective === true} onClick={() => onChange(true)}>
          {t("characters.custom")}
        </Button>
      </Row>
      {onPosition && (
        <IconButton
          label={t("characters.positionOnCanvas")}
          disabled={disabled}
          onClick={onPosition}
        >
          <LocateFixed size={14} />
        </IconButton>
      )}
      <span className="flex-1" />
      <IconButton
        label={t("characters.resetPositionMode")}
        disabled={value === null}
        onClick={() => onChange(null)}
      >
        <RotateCcw size={14} />
      </IconButton>
      <HelpMarker label={t("characters.positionMode")}>{t("characters.positionHelp")}</HelpMarker>
    </Row>
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
    <details
      className="character-position-fields [&_>_summary]:p-[5px_0] [&_>_summary_>_.tag]:ml-[7px]"
      ref={details}
    >
      <summary>
        {t("characters.position")}
        {overridden && (
          <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
            {t("characters.currentOverride")}
          </span>
        )}
      </summary>
      <Row
        gap={0}
        className="character-position-controls [&_>_.ui-field]:[flex:1_1_70px] flex items-end flex-wrap gap-[7px] p-[5px_0]"
      >
        {(["x", "y"] as const).map((axis) => (
          <Field key={axis} label={axis.toUpperCase()}>
            {grid ? (
              <Select
                aria-invalid={issues.some((issue) => issue.field === axis) || undefined}
                data-character-field={axis}
                value={String(value[axis])}
                onValueChange={(coordinate) => onChange({ ...value, [axis]: Number(coordinate) })}
                options={[
                  ...(!grid.includes(value[axis])
                    ? [
                        {
                          value: String(value[axis]),
                          label: `${t("characters.currentValue")}${value[axis]}`,
                        },
                      ]
                    : []),
                  ...grid.map((coordinate) => ({
                    value: String(coordinate),
                    label: String(coordinate),
                  })),
                ]}
              />
            ) : (
              <Input
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
      </Row>
    </details>
  );
}
