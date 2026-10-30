import { t, useTranslation } from "@/shared/i18n";
import { Field } from "@/shared/ui";

const modeLabel = (mode: string) =>
  mode === "sse"
    ? t("generation.ssePreview")
    : mode === "msgpack"
      ? t("generation.messagePackPreview")
      : mode;

import type { CreationInputs } from "@/bindings/workbench";

type StreamMode = NonNullable<CreationInputs["stream"]>;

export function StreamModeSelect({
  value,
  onChange,
  supported,
  modes,
}: {
  value: CreationInputs["stream"];
  onChange: (value: CreationInputs["stream"]) => void;
  supported: boolean | null;
  modes?: readonly StreamMode[] | null;
}) {
  useTranslation();

  const options = modes ?? [];
  const invalid =
    value !== null && (supported === false || (modes != null && !options.includes(value)));
  return (
    <div data-setting-field="stream">
      <Field label={t("generation.responseMode")}>
        <select
          value={value ?? ""}
          onChange={(event) => {
            const mode = options.find((option) => option === event.target.value);
            onChange(mode ?? null);
          }}
          aria-invalid={invalid}
        >
          <option value="">{t("generation.standardResponse")}</option>
          {options.map((mode) => (
            <option key={mode} value={mode} disabled={supported === false}>
              {modeLabel(mode)}
            </option>
          ))}
          {value && !options.includes(value) && <option value={value}>{modeLabel(value)}</option>}
        </select>
      </Field>
      {invalid && <span className="generation-danger">{t("generation.streamUnsupported")}</span>}
    </div>
  );
}
