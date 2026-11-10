import { buttonStyles, iconButtonStyles } from "./button";
import { Checkbox } from "@base-ui/react/checkbox";
import { Square, SquareCheck } from "lucide-react";

/** A compact checkbox keeps enabled state visible in icon toolbars. */
export function IconCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Checkbox.Root
      nativeButton
      render={<button type="button" aria-label={label} />}
      className={`${buttonStyles}  ${iconButtonStyles} icon-button icon-checkbox data-checked:text-(--accent)`}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {checked ? <SquareCheck size={16} aria-hidden /> : <Square size={16} aria-hidden />}
    </Checkbox.Root>
  );
}
