import { Grid, ConfirmIconButton, Field, HelpMarker, IconButton, Select } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ModelCapabilities, VibeReferenceInput } from "@/bindings/workbench";

import { preciseReferenceMessages } from "@/features/references/model";
import { VibeReferenceRow } from "./vibe-reference-row";
import { VibeMaterialDialog } from "./vibe-material-dialog";
import { referenceMode, showVibeReferences, type VibeIssues } from "./model";

export function VibeNormalize({
  value,
  inherited,
  onChange,
}: {
  value: boolean | null;
  inherited?: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  useTranslation();

  const id = useId();
  return (
    <Field
      className="vibe-normalize [&_.form-label]:min-w-0 grid grid-cols-[minmax(0,_1fr)_118px] items-center gap-space-3 grid-rows-[auto]"
      label={t("vibes.strengthNormalization")}
      htmlFor={id}
      help={
        <HelpMarker label={t("vibes.normalizationHelp")}>
          {t("vibes.normalizationDescription")}
        </HelpMarker>
      }
    >
      <Select
        id={id}
        className={value === null ? "text-muted" : undefined}
        value={value === null ? "inherit" : String(value)}
        onValueChange={(value) => onChange(referenceMode(value))}
        options={[
          {
            value: "inherit",
            label: `${inherited == null ? t("vibes.default") : inherited ? t("vibes.on") : t("vibes.off")}${t("vibes.inheritedTag")}`,
          },
          { value: "true", label: t("vibes.on") },
          { value: "false", label: t("vibes.off") },
        ]}
      />
    </Field>
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
  useTranslation();

  return showVibeReferences(props.capabilities) ? <Editor key={contextKey} {...props} /> : null;
}

function Editor({
  value,
  onChange,
  capabilities,
  normalizeValue = null,
  onNormalizeChange,
  issues,
}: Omit<VibeReferenceEditorProps, "contextKey">) {
  useTranslation();

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
    <Grid
      align="stretch"
      as="section"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="vibe-editor [&_>_h3]:m-0 [&_>_h3]:text-foreground [&_>_h3]:text-body [&_>_h3]:font-semibold grid gap-space-3 min-w-0"
      aria-label={t("vibes.vibeReferences")}
    >
      <header className="vibe-heading flex items-center gap-[5px] [&_h3]:m-0 [&_h3]:text-foreground [&_h3]:text-body [&_h3]:font-semibold [&_h3]:flex [&_h3]:items-center [&_h3]:gap-space-1">
        <h3>
          {t("vibes.vibeTransfer")}
          {value.length ? ` · ${value.length}` : ""}
          <HelpMarker label={t("vibes.vibeHelp")}>{t("vibes.vibeDescription")}</HelpMarker>
        </h3>
        <span className="flex-1" />
        <IconButton label={t("vibes.openMaterials")} onClick={() => setMaterials(true)}>
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
      {message && (
        <p className="vibe-message m-0 text-danger text-label wrap-anywhere">{message}</p>
      )}
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
                label={t("vibes.moveVibeUp", { value0: index + 1 })}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={13} />
              </IconButton>
              <IconButton
                label={t("vibes.moveVibeDown", { value0: index + 1 })}
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </IconButton>
              <ConfirmIconButton
                label={t("vibes.removeVibe", { value0: index + 1 })}
                description={t("vibes.confirmRemove")}
                onConfirm={() =>
                  update(latest.current.value.filter((item) => item.id !== reference.id))
                }
              >
                <Trash2 size={13} />
              </ConfirmIconButton>
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
    </Grid>
  );
}
