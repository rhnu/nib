import type { ComponentProps } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { t, useTranslation } from "@/shared/i18n";
import "./select.css";

type AutocompleteInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "list"> & {
  value: string;
  suggestions: readonly string[];
  onValueChange: (value: string) => void;
};

/** Optional suggestions keep free text editable and share the application's popup styling. */
export function AutocompleteInput({
  value,
  suggestions,
  onValueChange,
  disabled,
  required,
  ...inputProps
}: AutocompleteInputProps) {
  useTranslation();
  return (
    <Autocomplete.Root
      items={suggestions}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      required={required}
      openOnInputClick
      onOpenChange={(open, details) => {
        if (open && !suggestions.length) details.cancel();
      }}
    >
      <Autocomplete.Input {...inputProps} autoComplete="off" />
      {suggestions.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner className="select-positioner" align="start" sideOffset={4}>
            <Autocomplete.Popup className="select-popup">
              <Autocomplete.Empty className="empty-note">
                {t("common.noMatchingOptions")}
              </Autocomplete.Empty>
              <Autocomplete.List className="select-list">
                {(suggestion: string) => (
                  <Autocomplete.Item key={suggestion} value={suggestion} className="select-option">
                    {suggestion}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      )}
    </Autocomplete.Root>
  );
}
