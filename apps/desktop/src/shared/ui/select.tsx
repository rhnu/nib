import type { ComponentProps } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import "./select.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};

type SelectProps = Omit<
  ComponentProps<typeof BaseSelect.Trigger>,
  "value" | "onChange" | "children" | "className"
> & {
  className?: string;
  options: readonly SelectOption[];
  placeholder?: string;
} & (
    | {
        multiple?: false;
        value: string;
        onValueChange: (value: string) => void;
        clearLabel?: never;
      }
    | {
        multiple: true;
        value: string[];
        onValueChange: (value: string[]) => void;
        clearLabel: string;
      }
  );

/** Single and multiple choices share Base UI's positioning, keyboard and focus behavior. */
export function Select(props: SelectProps) {
  const {
    value,
    onValueChange: _onValueChange,
    multiple,
    placeholder,
    clearLabel,
    options,
    disabled,
    className = "",
    ...triggerProps
  } = props;
  const groups: { label?: string; options: SelectOption[] }[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (!last || last.label !== option.group)
      groups.push({ label: option.group, options: [option] });
    else last.options.push(option);
  }
  return (
    <BaseSelect.Root<string, boolean>
      value={value}
      multiple={multiple}
      onValueChange={(next) => {
        if (props.multiple && Array.isArray(next)) props.onValueChange(next);
        else if (!props.multiple && typeof next === "string") props.onValueChange(next);
      }}
      items={options}
      disabled={disabled}
    >
      <BaseSelect.Trigger {...triggerProps} className={`select-trigger ${className}`}>
        <BaseSelect.Value className="select-value" placeholder={placeholder}>
          {multiple
            ? (selected: string[]) => {
                const labels = selected.map(
                  (value) => options.find((option) => option.value === value)?.label ?? value,
                );
                return labels.length ? (
                  <span title={labels.join(", ")}>
                    {labels[0]}
                    {labels.length > 1 ? ` (+${labels.length - 1})` : ""}
                  </span>
                ) : (
                  placeholder
                );
              }
            : undefined}
        </BaseSelect.Value>
        <BaseSelect.Icon className="select-icon">
          <ChevronDown size={14} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="select-positioner"
        >
          <BaseSelect.Popup className="select-popup">
            <BaseSelect.List className="select-list">
              {groups.map((group, index) => (
                <BaseSelect.Group key={`${group.label ?? ""}-${index}`}>
                  {group.label && (
                    <BaseSelect.GroupLabel className="select-group-label">
                      {group.label}
                    </BaseSelect.GroupLabel>
                  )}
                  {group.options.map((option) => (
                    <BaseSelect.Item
                      key={option.value}
                      value={option.value}
                      label={option.label}
                      disabled={option.disabled}
                      className="select-option"
                    >
                      <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                      <BaseSelect.ItemIndicator className="select-check">
                        <Check size={14} aria-hidden />
                      </BaseSelect.ItemIndicator>
                    </BaseSelect.Item>
                  ))}
                </BaseSelect.Group>
              ))}
            </BaseSelect.List>
            {props.multiple && (
              <div className="select-footer">
                <button
                  type="button"
                  disabled={!value.length}
                  onClick={() => props.onValueChange([])}
                >
                  {clearLabel}
                </button>
              </div>
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
