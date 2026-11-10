import { useId, type HTMLAttributes, type ReactNode } from "react";
import { Col, Row, Toolbar } from "./stack";

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
    <Col
      as="section"
      gap={0}
      className={`@container/settings ${className}`}
      aria-labelledby={title ? headingId : undefined}
      {...props}
    >
      {(title || actions) && (
        <Row
          as="header"
          gap={3}
          wrap
          justify="between"
          className="gap-x-space-4 pb-space-3 border-b border-line"
        >
          {title && (
            <Heading
              id={headingId}
              className={`flex items-center gap-space-2 m-0 text-foreground font-semibold ${headingLevel === 2 ? "text-title" : "text-section"}`}
            >
              {title}
            </Heading>
          )}
          {actions && <Toolbar gap={3}>{actions}</Toolbar>}
        </Row>
      )}
      {description && (
        <p className="my-space-3 text-muted text-label leading-[1.7]">{description}</p>
      )}
      <Col
        gap={4}
        className="pt-space-3 [&:has(>.setting-row)]:gap-0 [&:has(>.setting-row)>:not(.setting-row)]:mt-space-4"
      >
        {children}
      </Col>
    </Col>
  );
}

const controlWidths = {
  short: "w-24",
  regular: "w-55",
  wide: "w-[min(420px,50%)] @max-[600px]/settings:w-full",
  auto: "w-auto",
};

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
  controlWidth?: keyof typeof controlWidths;
}) {
  return (
    <Row
      gap={4}
      justify="between"
      className={`setting-row gap-x-space-6 py-space-4 @max-[600px]/settings:flex-wrap [.setting-row+&]:border-t [.setting-row+&]:border-line-subtle ${className}`}
      data-control-width={controlWidth}
    >
      <Col gap={1} className="flex-1 wrap-anywhere @max-[600px]/settings:basis-50">
        <Row
          gap={2}
          className="[&>span]:inline-flex [&>span]:items-center [&>span]:flex-wrap [&>span]:gap-space-3"
        >
          {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
          {help}
        </Row>
        {description && (
          <div className="text-muted text-label leading-[1.7] [&_code]:[font-size:inherit]">
            {description}
          </div>
        )}
      </Col>
      <Row gap={3} justify="end" className={`shrink-0 max-w-full ${controlWidths[controlWidth]}`}>
        {children}
      </Row>
    </Row>
  );
}
