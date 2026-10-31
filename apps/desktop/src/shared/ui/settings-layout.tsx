import { useId, type HTMLAttributes, type ReactNode } from "react";
import "./settings-layout.css";

/** Groups related preferences without owning their values or persistence. */
export function SettingsGroup({
  title,
  description,
  actions,
  children,
  className = "",
  headingLevel = 3,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      className={`settings-group ${className}`}
      aria-labelledby={title ? headingId : undefined}
      {...props}
    >
      {(title || actions) && (
        <header className="settings-group-heading">
          {title && <Heading id={headingId}>{title}</Heading>}
          {actions && <div className="settings-group-actions">{actions}</div>}
        </header>
      )}
      {description && <p className="settings-group-description">{description}</p>}
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

/** A preference's label and explanation stay together while its control can wrap. */
export function SettingRow({
  label,
  htmlFor,
  description,
  help,
  children,
  className = "",
  controlWidth = "regular",
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  controlWidth?: "short" | "regular" | "wide" | "auto";
}) {
  return (
    <div className={`setting-row ${className}`} data-control-width={controlWidth}>
      <div className="setting-row-copy">
        <div className="setting-row-label">
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
          {help}
        </div>
        {description && <div className="setting-row-description">{description}</div>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
