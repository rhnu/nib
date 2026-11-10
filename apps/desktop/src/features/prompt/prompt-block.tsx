import { IconButton, IconCheckbox, Row, ButtonGroup } from "@/shared/ui";

import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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
      className={`prompt-node mt-space-3 [border:1px_solid_var(--line)] rounded-control bg-panel overflow-hidden [&_.prompt-editor-host]:[border:0] [&_.prompt-editor-host]:[border-top:1px_solid_var(--line-subtle)] [&_.prompt-editor-host]:rounded-none [&_.prompt-editor-host:focus-within]:[outline:none] [&_.prompt-editor-host:focus-within]:[border-top-color:var(--line-subtle)] [&:has(.cm-focused)]:border-accent [&_.prompt-editor-preview]:border-0 [&_.prompt-editor-preview]:border-t [&_.prompt-editor-preview]:border-line-subtle [&_.prompt-editor-preview]:rounded-none [&:first-child]:mt-0 border border-line${enabled ? "" : " node-disabled [&_.prompt-editor-host]:opacity-55 [&_.node-label]:opacity-[0.55] [&_.prompt-editor-preview]:opacity-[0.55]"}`}
      data-prompt-node-id={nodeId}
    >
      <Row
        gap={0}
        as="header"
        className="node-heading [&_>_.button-group]:shrink-0 [&_.icon-button]:w-[26px] [&_.icon-button]:h-[26px] [&_.icon-button]:min-h-[26px] [&_.icon-button]:p-[3px] flex items-center justify-between gap-space-2 py-0 px-space-2 min-h-[32px]"
      >
        <Row
          gap={0}
          as="span"
          className="node-label [&_>_svg]:text-muted [&_>_svg]:shrink-0 [&_>_span:not(.tag)]:overflow-hidden [&_>_span:not(.tag)]:text-ellipsis [&_>_span:not(.tag)]:whitespace-nowrap [&_.tag]:shrink-0 [&_.tag]:text-[9px] [&_.tag]:px-[3px] flex items-center gap-[7px] text-label min-w-0 wrap-anywhere"
        >
          {title}
        </Row>
        <ButtonGroup className="button-group">
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
        </ButtonGroup>
      </Row>
      <div id={contentId}>{children({ collapsed, onExpand: () => setCollapsed(false) })}</div>
    </article>
  );
}
