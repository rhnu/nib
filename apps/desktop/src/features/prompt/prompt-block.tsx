import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton, IconCheckbox } from "@/shared/ui";
import { t, useTranslation } from "@/shared/i18n";
import { usePromptBlockCollapse } from "./prompt-editor-state";

/** Editable fragments share a header and retain their editor while collapsed. */
export function PromptBlock({
  nodeId,
  defaultCollapsed = false,
  title,
  enabled,
  onEnabledChange,
  actions,
  children,
}: {
  nodeId: string;
  defaultCollapsed?: boolean;
  title: ReactNode;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  actions?: ReactNode;
  children: (state: { collapsed: boolean; onExpand: () => void }) => ReactNode;
}) {
  useTranslation();

  const [collapsed, setCollapsed] = usePromptBlockCollapse(nodeId, defaultCollapsed);
  const contentId = useId();
  return (
    <article
      className={`prompt-node${enabled ? "" : " node-disabled"}`}
      data-prompt-node-id={nodeId}
    >
      <header className="node-heading">
        <span className="node-label">{title}</span>
        <div className="button-group">
          <IconCheckbox
            checked={enabled}
            label={t("prompt.enableSegment")}
            onChange={onEnabledChange}
          />
          {actions}
          <IconButton
            label={t(collapsed ? "prompt.expandEditor" : "prompt.collapseEditor")}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            data-prompt-expand
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight size={14} aria-hidden />
            ) : (
              <ChevronDown size={14} aria-hidden />
            )}
          </IconButton>
        </div>
      </header>
      <div id={contentId}>{children({ collapsed, onExpand: () => setCollapsed(false) })}</div>
    </article>
  );
}
