import { useId, type ComponentProps, type ReactNode } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { FieldAssociation } from "./field-context";
import { InputRow } from "./input-group";
import { Row } from "../layout/stack";

/** Labels, help and feedback are presentation; callers own values and validation. */
export function Field({
  label,
  htmlFor,
  help,
  actions,
  children,
  feedback,
  error,
  description,
  className = "",
  inherited = false,
  required = false,
  hideLabel = false,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  label?: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  feedback?: ReactNode;
  error?: ReactNode;
  description?: ReactNode;
  inherited?: boolean;
  required?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  const controlId = htmlFor ?? `${id}-control`;
  const invalid = Boolean(error);
  const labelId = label !== undefined ? `${id}-label` : undefined;
  const describedBy =
    [
      description ? `${id}-description` : undefined,
      error || feedback ? `${id}-feedback` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <FieldAssociation value={{ controlId, labelId, describedBy, invalid, required }}>
      <BaseField.Root
        invalid={invalid || undefined}
        className={`ui-field form-field [:where(&)]:grid [:where(&)]:min-w-0 [:where(&)]:gap-(--space-1) ${className}`}
        data-inherited={inherited || undefined}
        {...props}
      >
        {(label !== undefined || help) && (
          <Row
            gap={1}
            className={`form-label text-muted text-label leading-5 ${hideLabel ? "sr-only" : "min-h-(--label-height)"}`}
          >
            {label !== undefined && (
              <BaseField.Label id={labelId} htmlFor={htmlFor}>
                {label}
                {required && (
                  <span aria-hidden="true" className="text-danger">
                    {" "}
                    *
                  </span>
                )}
              </BaseField.Label>
            )}
            {help}
          </Row>
        )}
        <InputRow className="form-control">
          {children}
          {actions !== undefined && (
            <FieldAssociation value={null}>
              <BaseField.Root className="form-actions [:where(&)]:flex [:where(&)]:shrink-0 [:where(&)]:items-center">
                {actions}
              </BaseField.Root>
            </FieldAssociation>
          )}
        </InputRow>
        {description && (
          <BaseField.Description
            id={`${id}-description`}
            className="[:where(&)]:text-(--muted) [:where(&)]:text-(length:--font-size-label)"
          >
            {description}
          </BaseField.Description>
        )}
        {(error || feedback) && (
          <div
            id={`${id}-feedback`}
            role={invalid ? "alert" : undefined}
            className={`form-feedback [:where(&)]:text-(length:--font-size-label) ${invalid ? "text-(--danger)" : "text-(--muted)"}`}
          >
            {error}
            {feedback}
          </div>
        )}
      </BaseField.Root>
    </FieldAssociation>
  );
}
