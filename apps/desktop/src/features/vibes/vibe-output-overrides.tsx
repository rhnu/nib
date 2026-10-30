import { t, useTranslation } from "@/shared/i18n";
import { RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type {
  ModelCapabilities,
  VibeReferenceInput,
  VibeReferenceOverride,
} from "@/bindings/workbench";
import { IconButton } from "@/shared/ui";
import { VibeReferenceRow } from "./vibe-reference-row";
import { VibeNormalize } from "./vibe-reference-editor";
import { applyVibeOverride, patchVibeOverride, showVibeReferences, type VibeIssues } from "./model";
import "./vibes.css";

export interface VibeOutputOverridesProps {
  value: VibeReferenceInput[];
  overrides: VibeReferenceOverride[];
  onChange: (value: VibeReferenceOverride[]) => void;
  capabilities: ModelCapabilities | null;
  contextKey?: string | number;
  normalizeValue?: boolean | null;
  normalizeInherited?: boolean | null;
  onNormalizeChange?: (value: boolean | null) => void;
  issues?: VibeIssues;
}

export function VibeOutputOverrides({ contextKey, ...props }: VibeOutputOverridesProps) {
  useTranslation();

  return showVibeReferences(props.capabilities) ? <Overrides key={contextKey} {...props} /> : null;
}

function Overrides({
  value,
  overrides,
  onChange,
  capabilities,
  normalizeValue = null,
  normalizeInherited,
  onNormalizeChange,
  issues,
}: Omit<VibeOutputOverridesProps, "contextKey">) {
  useTranslation();

  const latest = useRef({ overrides, onChange });
  useLayoutEffect(() => {
    Object.assign(latest.current, { overrides, onChange });
  }, [overrides, onChange]);

  const patch = (id: string, change: Partial<Omit<VibeReferenceOverride, "id">>) => {
    const next = patchVibeOverride(latest.current.overrides, id, change);
    latest.current.overrides = next;
    latest.current.onChange(next);
  };

  const stale = overrides.filter((item) => !value.some((source) => source.id === item.id));
  return (
    <section className="vibe-editor" aria-label={t("vibes.presetVibeOverrides")}>
      <h3>
        {t("vibes.vibeHeading")}
        {value.length}
      </h3>
      {onNormalizeChange && (
        <div data-vibe-field="normalizeStrength">
          <VibeNormalize
            value={normalizeValue}
            inherited={
              normalizeInherited ?? capabilities?.vibeReferenceOptions.normalizeStrengthDefault
            }
            onChange={onNormalizeChange}
          />
        </div>
      )}
      {value.map((original, index) => {
        const override = overrides.find((item) => item.id === original.id);
        return (
          <VibeReferenceRow
            key={original.id}
            value={applyVibeOverride(original, override)}
            index={index}
            capabilities={capabilities}
            issues={issues?.[original.id]}
            override={override}
            onChange={(change) => patch(original.id, change)}
            onReset={(field) => patch(original.id, { [field]: null })}
            actions={
              override && (
                <IconButton
                  label={t("vibes.revertVibeOverrides", { value0: index + 1 })}
                  onClick={() => patch(original.id, { enabled: null, input: null, strength: null })}
                >
                  <RotateCcw size={14} />
                </IconButton>
              )
            }
          />
        );
      })}
      {stale.map((item) => (
        <div key={item.id} data-vibe-id={item.id} className="vibe-message">
          {t("vibes.originalVibeMissing")}
          <IconButton
            label={t("vibes.removeStaleVibeOverride")}
            onClick={() => onChange(overrides.filter((value) => value.id !== item.id))}
          >
            <RotateCcw size={14} />
          </IconButton>
        </div>
      ))}
    </section>
  );
}
