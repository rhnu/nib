import { useEffect, useRef, useState } from "react";
import { SettingsEditor, type SettingsEditorProps } from "../prompt/SettingsEditor";
import { diagnosticSetting } from "../prompt/settings";
import "./GenerationParameterPanel.css";

/** The dock owns disclosure state; sparse parameter edits remain with the draft. */
export function GenerationParameterPanel(props: Omit<SettingsEditorProps, "fields">) {
  const [open, setOpen] = useState(true);
  const panel = useRef<HTMLDetailsElement>(null);
  const { value, capabilities, resolved, diagnostics = [], errorFields = [] } = props;
  const effective = resolved ?? capabilities?.defaults;
  const steps = value.steps ?? effective?.steps;
  const scale = value.scale ?? effective?.scale;
  const summary = [
    steps === undefined ? null : `${steps} 步`,
    scale === undefined ? null : `Guidance ${scale}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const issueSignature = JSON.stringify([diagnostics, errorFields]);
  const hasParameterIssue = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => {
      const key = diagnosticSetting(field);
      return (
        (key !== null &&
          !["model", "quality", "ucPreset", "furryMode", "size", "nSamples", "useCoords"].includes(
            key,
          )) ||
        field.split(".").includes("policy")
      );
    },
  );
  useEffect(() => {
    if (hasParameterIssue && panel.current) panel.current.open = true;
  }, [hasParameterIssue, issueSignature]);
  return (
    <details
      className="generation-parameter-panel"
      ref={panel}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>生成参数</span>
        {!open && summary && <small>{summary}</small>}
      </summary>
      <div className="generation-parameter-content">
        <SettingsEditor {...props} fields="parameters" />
      </div>
    </details>
  );
}
