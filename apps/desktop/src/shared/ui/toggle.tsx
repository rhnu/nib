import { Switch } from "@base-ui/react/switch";

export function Toggle({
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
    <Switch.Root
      nativeButton
      render={<button type="button" aria-label={label} />}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      className="toggle"
      aria-label={label}
      title={label}
    >
      <Switch.Thumb className="toggle-thumb" />
    </Switch.Root>
  );
}
