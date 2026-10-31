import { t, useTranslation } from "@/shared/i18n";
import { Field, Select } from "@/shared/ui";

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
        <Select
          value={value ?? ""}
          aria-label={t("generation.responseMode")}
          onValueChange={(next) => {
            const mode = options.find((option) => option === next);
            onChange(mode ?? null);
          }}
          aria-invalid={invalid}
          options={[
            { value: "", label: t("generation.standardResponse") },
            ...options.map((mode) => ({
              value: mode,
              label: modeLabel(mode),
              disabled: supported === false,
            })),
            ...(value && !options.includes(value) ? [{ value, label: modeLabel(value) }] : []),
          ]}
        />
      </Field>
      {invalid && <span className="generation-danger">{t("generation.streamUnsupported")}</span>}
    </div>
  );
}
