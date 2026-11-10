import type { ComponentProps } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { useFieldAssociation } from "../forms/field-context";

export const inputStyles =
  "[:where(&)]:[font:inherit] [:where(&)]:border-solid [:where(&)]:min-w-0 [:where(&)]:w-full [:where(&)]:rounded-(--radius) [:where(&)]:border [:where(&)]:border-(--line) [:where(&)]:bg-(--input) [:where(&)]:px-(--space-3) [:where(&)]:py-(--space-2) [:where(&)]:text-inherit [:where(&)]:outline-none [:where(&)]:placeholder:text-(--muted) [:where(&)]:placeholder:opacity-75 [:where(&)]:focus:border-(--accent) [:where(&)]:focus-visible:outline-2 [:where(&)]:focus-visible:outline-(--accent) [:where(&)]:focus-visible:outline-offset-2 [:where(&)]:disabled:opacity-45 [:where(&)]:disabled:cursor-default [:where(&)]:aria-invalid:border-(--danger)";

/** Native input props and refs remain available; Base UI associates Field labels. */
export function Input({
  className = "",
  id,
  type = "text",
  required,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<"input">) {
  const field = useFieldAssociation();
  const nativeType = ["checkbox", "radio", "range", "file", "hidden", "color"].includes(type);
  const nativeStyles =
    "[:where(&)]:[font:inherit] [:where(&)]:text-inherit [:where(&)]:accent-(--accent) [:where(&)]:focus-visible:outline-2 [:where(&)]:focus-visible:outline-(--accent) [:where(&)]:focus-visible:outline-offset-2 [:where(&)]:disabled:opacity-45 [:where(&)]:disabled:cursor-default";
  const controlStyles = nativeType
    ? nativeStyles
    : `${inputStyles} [:where(&)]:h-(--control-height)`;
  const association = {
    id: id ?? field?.controlId,
    "aria-describedby": [describedBy, field?.describedBy].filter(Boolean).join(" ") || undefined,
  };
  return (
    <BaseInput
      type={type}
      required={required ?? field?.required}
      {...association}
      className={`${controlStyles}  ${className}`}
      {...props}
    />
  );
}

/** Multiline native editing shares input styling and the field's description. */
export function Textarea({
  className = "",
  id,
  required,
  "aria-describedby": describedBy,
  "aria-labelledby": labelledBy,
  ...props
}: ComponentProps<"textarea">) {
  const field = useFieldAssociation();
  return (
    <BaseField.Control
      value={props.value}
      defaultValue={props.defaultValue}
      disabled={props.disabled}
      name={props.name}
      id={id ?? field?.controlId}
      required={required ?? field?.required}
      render={
        <textarea
          id={id ?? field?.controlId}
          aria-labelledby={labelledBy ?? field?.labelId}
          aria-describedby={
            [describedBy, field?.describedBy].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={field?.invalid || undefined}
          className={`${inputStyles} [:where(&)]:min-h-27 [:where(&)]:resize-y [:where(&)]:text-sm [:where(&)]:leading-[1.75] ${className}`}
          {...props}
        />
      }
    />
  );
}
