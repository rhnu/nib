import { t, useTranslation } from "@/shared/i18n";
import { useId, useState } from "react";
import { ChevronUp } from "lucide-react";
import { SettingsEditor, type SettingsEditorProps } from "@/features/prompt/settings-editor";
import { diagnosticSetting, settingLabels, settingValue } from "@/features/prompt/settings";
import { Button } from "@/shared/ui";
import "./generation-parameter-panel.css";

/** The dock owns disclosure state; sparse parameter edits remain with the draft. */
export function GenerationParameterPanel(props: Omit<SettingsEditorProps, "fields">) {
  useTranslation();

  const contentId = useId();
  const { value, capabilities, resolved, diagnostics = [], errorFields = [] } = props;
  const effective = resolved ?? capabilities?.defaults;
  const summary = (["steps", "scale", "seed", "sampler"] as const).map((key) => {
    const current = value[key] ?? effective?.[key];
    return {
      key,
      label: settingLabels[key],
      value:
        current === undefined
          ? "—"
          : key === "seed" && current === 0
            ? t("prompt.randomSeed")
            : settingValue(key, current),
    };
  });
  const issueSignature = JSON.stringify([diagnostics, errorFields]);
  const hasParameterIssue = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => {
      const key = diagnosticSetting(field);
      return (
        (key !== null &&
          ![
            "model",
            "quality",
            "ucPreset",
            "furryMode",
            "size",
            "nSamples",
            "useCoords",
            "transparentBackground",
          ].includes(key)) ||
        field.split(".").some((part) => part === "policy" || part === "stream")
      );
    },
  );
  const [open, setOpen] = useState(hasParameterIssue);
  const [seenIssue, setSeenIssue] = useState(issueSignature);
  if (seenIssue !== issueSignature) {
    setSeenIssue(issueSignature);
    if (hasParameterIssue) setOpen(true);
  }
  return (
    <section className="generation-parameter-panel" data-open={open || undefined}>
      <div id={contentId} className="generation-parameter-content" hidden={!open}>
        <SettingsEditor {...props} fields="parameters" />
      </div>
      <Button
        className="generation-parameter-toggle"
        data-parameter-toggle
        aria-label={t("workbench.generationParameters")}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <span className="generation-parameter-summary">
          {summary.map((item) => (
            <span key={item.key}>
              <span>{item.label}</span>
              <strong title={item.value}>{item.value}</strong>
            </span>
          ))}
        </span>
        <ChevronUp size={14} aria-hidden />
      </Button>
    </section>
  );
}
