import { Field, Select } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { settingValue } from "@/features/prompt/settings";

/** Resource model restrictions share a controlled selector in individual and batch edits. */
export function ResourceModelSelect({
  models,
  value,
  onChange,
}: {
  models: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  useTranslation();
  return (
    <Field label={t("library.models")}>
      <Select
        multiple
        value={value}
        onValueChange={onChange}
        placeholder={t("library.modelsHint")}
        clearLabel={t("library.clearSelection")}
        options={[...new Set([...models, ...value])].map((model) => ({
          value: model,
          label: settingValue("model", model),
        }))}
      />
    </Field>
  );
}
