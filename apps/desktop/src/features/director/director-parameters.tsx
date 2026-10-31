import { t, useTranslation } from "@/shared/i18n";
import type { RefObject } from "react";
import type { DirectorToolState } from "@/bindings/workbench";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { Field, HelpMarker, Select } from "@/shared/ui";

export function DirectorParameters({
  state,
  onChange,
  advancedRef,
}: {
  state: DirectorToolState;
  onChange: (patch: Partial<DirectorToolState>) => void;
  advancedRef: RefObject<HTMLDetailsElement | null>;
}) {
  useTranslation();

  const command = state.command;
  const text =
    typeof command === "object"
      ? "emotion" in command
        ? command.emotion
        : command.colorize
      : null;

  const updateText = (patch: { prompt?: string; defry?: number }) => {
    if (typeof command !== "object") return;
    if ("emotion" in command) onChange({ command: { emotion: { ...command.emotion, ...patch } } });
    else onChange({ command: { colorize: { ...command.colorize, ...patch } } });
  };

  return (
    <div className="director-parameters">
      {text && (
        <>
          <Field
            label={
              state.tool === "emotion" ? t("director.requiredPrompt") : t("director.optionalPrompt")
            }
          >
            <div data-director-field="prompt">
              <PromptTextEditor
                label={t("director.toolPrompt")}
                value={text.prompt ?? ""}
                onChange={(prompt) => updateText({ prompt })}
                tokenUnavailableLabel={t("director.tokenRulesUnavailable")}
              />
            </div>
          </Field>
          <Field
            label={
              state.tool === "emotion" ? t("director.emotionLevel") : t("director.colorizeDefry")
            }
          >
            <input
              data-director-field="defry"
              type="number"
              step="1"
              value={text.defry}
              onWheel={(event) => event.currentTarget.blur()}
              onChange={(event) => {
                if (Number.isFinite(event.currentTarget.valueAsNumber))
                  updateText({ defry: event.currentTarget.valueAsNumber });
              }}
            />
          </Field>
        </>
      )}
      <details className="director-advanced" ref={advancedRef}>
        <summary>
          {t("director.advancedSettings")}
          {state.policy === "reject" ? t("director.strictSuffix") : ""}
        </summary>
        <Field label={t("director.parameterHandling")}>
          <Select
            data-director-field="policy"
            value={state.policy}
            onValueChange={(value) => onChange({ policy: value as DirectorToolState["policy"] })}
            options={[
              { value: "normalize", label: t("director.autoAdjust") },
              { value: "reject", label: t("director.strict") },
            ]}
          />
        </Field>
      </details>
      {state.tool === "emotion" && (
        <HelpMarker label={t("director.emotionInputHelpTitle")}>
          {t("director.emotionInputHelp")}
        </HelpMarker>
      )}
    </div>
  );
}
