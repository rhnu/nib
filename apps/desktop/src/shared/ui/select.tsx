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

/** Theme-aware choices share Base UI's positioning, keyboard and focus behavior. */
export function Select({
  value,
  onValueChange,
  options,
  disabled,
  className = "",
  ...triggerProps
}: Omit<
  ComponentProps<typeof BaseSelect.Trigger>,
  "value" | "onChange" | "children" | "className"
> & {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
}) {
  const groups: { label?: string; options: SelectOption[] }[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (!last || last.label !== option.group)
      groups.push({ label: option.group, options: [option] });
    else last.options.push(option);
  }
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={options}
      disabled={disabled}
    >
      <BaseSelect.Trigger {...triggerProps} className={`select-trigger ${className}`}>
        <BaseSelect.Value className="select-value" />
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
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
