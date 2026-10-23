import type { RefObject } from "react";
import type { DirectorToolState } from "../../bindings/workbench";
import { Field, HelpMarker } from "../../shared/ui";

export function DirectorParameters({
  state,
  onChange,
  advancedRef,
}: {
  state: DirectorToolState;
  onChange: (patch: Partial<DirectorToolState>) => void;
  advancedRef: RefObject<HTMLDetailsElement | null>;
}) {
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
          <Field label={state.tool === "emotion" ? "Prompt · 必填" : "Prompt · 可选"}>
            <textarea
              data-director-field="prompt"
              aria-label="导演工具 Prompt"
              value={text.prompt ?? ""}
              rows={5}
              spellCheck={false}
              onChange={(event) => updateText({ prompt: event.target.value })}
            />
          </Field>
          <Field label={state.tool === "emotion" ? "Emotion Level · Defry" : "Colorize Defry"}>
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
        <summary>高级设置{state.policy === "reject" ? " · 严格拒绝" : ""}</summary>
        <Field label="参数处理">
          <select
            data-director-field="policy"
            value={state.policy}
            onChange={(event) =>
              onChange({ policy: event.target.value as DirectorToolState["policy"] })
            }
          >
            <option value="normalize">自动调整</option>
            <option value="reject">严格拒绝</option>
          </select>
        </Field>
      </details>
      {state.tool === "emotion" && (
        <HelpMarker label="情绪输入建议">
          清晰、正面的单个动漫角色面部效果较稳定。可先处理为 neutral expression，再继续调整表情。
        </HelpMarker>
      )}
    </div>
  );
}
