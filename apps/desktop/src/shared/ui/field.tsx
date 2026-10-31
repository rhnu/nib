import type { ReactNode } from "react";

/** Shared tracks keep labels, controls and feedback aligned across neighboring fields. */
export function FormGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`form-grid ${className}`}>{children}</div>;
}

/** A labeled control row with optional help, adjacent actions and validation feedback. */
export function FormField({
  label,
  htmlFor,
  help,
  actions,
  children,
  feedback,
  className = "",
  inherited = false,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  feedback?: ReactNode;
  className?: string;
  inherited?: boolean;
}) {
  return (
    <div className={`form-field ${className}`} data-inherited={inherited || undefined}>
      <div className="form-label">
        <label htmlFor={htmlFor}>{label}</label>
        {help}
      </div>
      <div className="form-control">
        {children}
        {actions !== undefined && <div className="form-actions">{actions}</div>}
      </div>
      <div className="form-feedback">{feedback}</div>
    </div>
  );
}

/** A native label keeps its single control associated without duplicating form state. */
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
