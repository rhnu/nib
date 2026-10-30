import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
export function Notice({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="alert" className="error-banner flex flex-wrap items-center gap-2.5">
      <CircleAlert size={16} />
      <span>{children}</span>
      {actions}
    </div>
  );
}
