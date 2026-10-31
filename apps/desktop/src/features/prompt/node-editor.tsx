import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Link2, Trash2, Type } from "lucide-react";
import type { PromptNode, Resource } from "@/bindings/workbench";
import { ActionsMenu, IconButton } from "@/shared/ui";
import { PromptTextEditor } from "./prompt-text-editor";
import { PromptBlock } from "./prompt-block";

export function NodeEditor({
  node,
  resource,
  onChange,
  up,
  down,
  canUp,
  canDown,
  remove,
  expand,
  model,
}: {
  node: PromptNode;
  resource?: Resource;
  onChange: (node: PromptNode) => void;
  up: () => void;
  down: () => void;
  canUp: boolean;
  canDown: boolean;
  remove: () => void;
  expand: (node: PromptNode) => Promise<PromptNode>;
  model?: string;
}) {
  useTranslation();

  const latest = useRef({ node, onChange, active: true });
  useLayoutEffect(() => {
    latest.current.node = node;
    latest.current.onChange = onChange;
  }, [node, onChange]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const sourceText = resource?.content.kind === "chunk" ? resource.content.text : "";
  return (
    <PromptBlock
      nodeId={node.id}
      defaultCollapsed={node.kind === "chunk"}
      enabled={node.enabled}
      onEnabledChange={(enabled) => onChange({ ...latest.current.node, enabled })}
      title={
        <>
          {node.kind === "chunk" ? <Link2 size={14} /> : <Type size={14} />}
          <span title={node.kind === "chunk" ? resource?.name : undefined}>
            {node.kind === "chunk"
              ? (resource?.name ?? t("prompt.resourceMissing"))
              : t("prompt.text")}
          </span>
          {node.kind === "chunk" && node.overrideText !== null && (
            <span className="tag">{t("prompt.instanceOverride")}</span>
          )}
        </>
      }
      actions={
        <>
          <IconButton label={t("prompt.moveUp")} onClick={up} disabled={!canUp}>
            <ArrowUp size={14} aria-hidden />
          </IconButton>
          <IconButton label={t("prompt.moveDown")} onClick={down} disabled={!canDown}>
            <ArrowDown size={14} aria-hidden />
          </IconButton>
          {node.kind === "chunk" && (
            <ActionsMenu
              label={t("prompt.segmentActions")}
              items={[
                {
                  label: t("prompt.expandToText"),
                  action: () => {
                    void expand(node).then((result) => {
                      if (latest.current.active && latest.current.node === node && result !== node)
                        latest.current.onChange(result);
                    });
                  },
                },
                {
                  label: t("prompt.revertOverride"),
                  action: () => onChange({ ...node, overrideText: null }),
                  disabled: node.overrideText === null,
                },
              ]}
            />
          )}
          <IconButton label={t("prompt.removeSegment")} onClick={remove} className="danger">
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </>
      }
    >
      {({ collapsed, onExpand }) => (
        <PromptTextEditor
          collapsed={collapsed}
          onExpand={onExpand}
          sizing="content"
          label={
            node.kind === "text"
              ? t("prompt.promptText")
              : t("prompt.instanceContent", { value0: resource?.name ?? t("prompt.missingChunk") })
          }
          model={model}
          value={node.kind === "text" ? node.text : (node.overrideText ?? sourceText)}
          placeholder={
            node.kind === "text"
              ? t("prompt.promptPlaceholder")
              : resource
                ? t("prompt.emptyChunk")
                : t("prompt.missingResourceHelp")
          }
          onChange={(text) =>
            onChange(node.kind === "text" ? { ...node, text } : { ...node, overrideText: text })
          }
        />
      )}
    </PromptBlock>
  );
}
