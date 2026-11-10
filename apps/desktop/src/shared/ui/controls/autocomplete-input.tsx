import { inputStyles } from "./input";
import { useFieldAssociation } from "../forms/field-context";
import { uiStyles } from "./styles";
import type { ComponentProps } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { t, useTranslation } from "@/shared/i18n";

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
  className = "",
  ...inputProps
}: AutocompleteInputProps) {
  useTranslation();
  const field = useFieldAssociation();
  return (
    <Autocomplete.Root
      items={suggestions}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      required={required ?? field?.required}
      openOnInputClick
      onOpenChange={(open, details) => {
        if (open && !suggestions.length) details.cancel();
      }}
    >
      <Autocomplete.Input
        {...inputProps}
        id={inputProps.id ?? field?.controlId}
        aria-describedby={
          [inputProps["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") ||
          undefined
        }
        className={`${inputStyles} [:where(&)]:h-(--control-height) ${className}`}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className={`select-positioner ${uiStyles["select-positioner"]}`}
            align="start"
            sideOffset={4}
          >
            <Autocomplete.Popup className={`select-popup ${uiStyles["select-popup"]}`}>
              <Autocomplete.Empty
                className={`empty-note text-muted text-label leading-[1.75] m-[3px_0]`}
              >
                {t("common.noMatchingOptions")}
              </Autocomplete.Empty>
              <Autocomplete.List className={`select-list ${uiStyles["select-list"]}`}>
                {(suggestion: string) => (
                  <Autocomplete.Item
                    key={suggestion}
                    value={suggestion}
                    className={`select-option ${uiStyles["select-option"]}`}
                  >
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
