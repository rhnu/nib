import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "@/bindings/workbench";
import { IconButton } from "@/shared/ui";
import {
  applyPreciseReferenceOverride,
  patchPreciseReferenceOverride,
  type PreciseReferenceIssues,
} from "./model";
import { PreciseReferenceAvailability, PreciseReferenceRow } from "./precise-reference-row";
import "./references.css";

export interface PreciseReferenceOutputOverridesProps {
  value: PreciseReferenceInput[];
  overrides: PreciseReferenceOverride[];
  onChange: (overrides: PreciseReferenceOverride[]) => void;
  capabilities: ModelCapabilities | null;
  contextKey?: string | number;
  issues?: PreciseReferenceIssues;
}

/** Linked instances retain source order and identity while storing only explicit changes. */
export function PreciseReferenceOutputOverrides({
  contextKey,
  ...props
}: PreciseReferenceOutputOverridesProps) {
  useTranslation();

  return <OutputOverridesContent key={contextKey} {...props} />;
}

function OutputOverridesContent({
  value,
  overrides,
  onChange,
  capabilities,
  issues,
}: Omit<PreciseReferenceOutputOverridesProps, "contextKey">) {
  useTranslation();

  const latest = useRef({ active: true, overrides, onChange });
  useLayoutEffect(() => {
    Object.assign(latest.current, { overrides, onChange });
  }, [overrides, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);

  const update = (apply: (overrides: PreciseReferenceOverride[]) => PreciseReferenceOverride[]) => {
    const current = latest.current;
    if (!current.active) return;
    const next = apply(current.overrides);
    current.overrides = next;
    current.onChange(next);
  };

  if (!value.length && !overrides.length) return null;
  const stale = overrides.filter(
    (override) => !value.some((reference) => reference.id === override.id),
  );
  return (
    <section
      className="precise-reference-editor"
      aria-label={t("references.presetPreciseOverrides")}
    >
      <h3>
        {t("references.preciseReferencePrefix")}
        {value.length}
      </h3>
      <PreciseReferenceAvailability capabilities={capabilities} />
      {value.map((original, index) => {
        const override = overrides.find((item) => item.id === original.id);
        return (
          <PreciseReferenceRow
            key={original.id}
            value={applyPreciseReferenceOverride(original, override)}
            index={index}
            capabilities={capabilities}
            issues={issues?.[original.id]}
            override={override}
            onChange={(patch) =>
              update((overrides) => patchPreciseReferenceOverride(overrides, original.id, patch))
            }
            onReset={(field) =>
              update((overrides) =>
                patchPreciseReferenceOverride(overrides, original.id, { [field]: null }),
              )
            }
            actions={
              override && (
                <IconButton
                  label={t("references.revertPreciseOverrides", { value0: index + 1 })}
                  onClick={() =>
                    update((overrides) => overrides.filter((item) => item.id !== original.id))
                  }
                >
                  <RotateCcw size={14} />
                </IconButton>
              )
            }
          />
        );
      })}
      {stale.map((override) => (
        <div
          key={override.id}
          className="precise-reference-message"
          data-reference-id={override.id}
        >
          {t("references.originalReferenceMissing")}
          <IconButton
            label={t("references.removeStalePreciseOverride")}
            onClick={() =>
              update((overrides) => overrides.filter((item) => item.id !== override.id))
            }
          >
            <RotateCcw size={14} />
          </IconButton>
        </div>
      ))}
    </section>
  );
}
