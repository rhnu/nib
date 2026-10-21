import type { ReactNode } from "react";
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
    <label className={`field grid min-w-0 gap-1 ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
