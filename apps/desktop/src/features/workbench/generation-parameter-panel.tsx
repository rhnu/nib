import { Button, Grid, Col } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useId, useState } from "react";
import { ChevronUp } from "lucide-react";
import { SettingsEditor, type SettingsEditorProps } from "@/features/prompt/settings-editor";
import { diagnosticSetting, settingLabels, settingValue } from "@/features/prompt/settings";

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
    <section
      className="generation-parameter-panel min-w-0 [.generation-actions:has(&[data-open])_>_.generation-account-balance]:hidden"
      data-open={open || undefined}
    >
      <div
        id={contentId}
        className="generation-parameter-content [&_.form-label]:min-h-[21px] [&_.settings-fields]:gap-y-[5px] [&_.settings-fields]:gap-x-space-3 [&_.advanced-settings]:pt-[7px] max-h-[min(52dvh,_480px)] overflow-y-auto py-space-3 px-0 [scrollbar-gutter:stable]"
        hidden={!open}
      >
        <SettingsEditor {...props} fields="parameters" />
      </div>
      <Button
        className="generation-parameter-toggle [&[aria-expanded=true]_>_svg]:[transform:rotate(180deg)] w-full justify-between py-[3px] px-[2px] border-transparent bg-transparent"
        data-parameter-toggle
        aria-label={t("workbench.generationParameters")}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <Grid
          gap={0}
          align="stretch"
          as="span"
          className="generation-parameter-summary [&_>_span_>_span]:text-muted [&_>_span_>_span]:font-normal [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:tabular-nums [&_>_span]:grid [&_>_span]:gap-0 [&_>_span]:min-w-0 grid grid-cols-[0.6fr_0.9fr_1fr_1.25fr] gap-space-3 flex-1 min-w-0 text-left text-label leading-[16px]"
        >
          {summary.map((item) => (
            <Col gap={0} as="span" key={item.key}>
              <span>{item.label}</span>
              <strong title={item.value}>{item.value}</strong>
            </Col>
          ))}
        </Grid>
        <ChevronUp size={14} aria-hidden />
      </Button>
    </section>
  );
}
