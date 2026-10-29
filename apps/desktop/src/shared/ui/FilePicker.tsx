import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "./Button";

/** A named button exposes the native chooser; the receiving feature owns import work and errors. */
export function FilePicker({
  label,
  accept,
  disabled = false,
  title,
  onChoose,
}: {
  label: string;
  accept: string;
  disabled?: boolean;
  title?: string;
  onChoose: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="file-picker">
      <Button disabled={disabled} title={title} onClick={() => input.current?.click()}>
        <Upload size={14} aria-hidden />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onChoose(file);
        }}
      />
    </span>
  );
}
