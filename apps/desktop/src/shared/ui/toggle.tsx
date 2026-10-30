import { Switch } from "@base-ui/react/switch";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      nativeButton
      render={<button type="button" aria-label={label} />}
      checked={checked}
      onCheckedChange={onChange}
      className="toggle"
      aria-label={label}
      title={label}
    >
      <Switch.Thumb className="toggle-thumb" />
    </Switch.Root>
  );
}
