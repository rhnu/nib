import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link2, Type } from "lucide-react";
import type { PromptNode, Resource } from "@/bindings/workbench";
import { ActionsMenu, Toggle } from "@/shared/ui";
import { PromptTextEditor } from "./prompt-text-editor";

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
    <article
      className={`prompt-node ${node.enabled ? "" : "node-disabled"}`}
      data-prompt-node-id={node.id}
    >
      <header className="node-heading">
        <span className="node-label">
          {node.kind === "chunk" ? <Link2 size={14} /> : <Type size={14} />}
          {node.kind === "chunk"
            ? (resource?.name ?? t("prompt.resourceMissing"))
            : t("prompt.text")}
        </span>
        <div className="button-group">
          {node.kind === "chunk" && node.overrideText !== null && (
            <span className="tag">{t("prompt.instanceOverride")}</span>
          )}
          <Toggle
            checked={node.enabled}
            label={t("prompt.enableSegment")}
            onChange={(enabled) => onChange({ ...node, enabled })}
          />
          <ActionsMenu
            label={t("prompt.segmentActions")}
            items={[
              { label: t("prompt.moveUp"), action: up, disabled: !canUp },
              { label: t("prompt.moveDown"), action: down, disabled: !canDown },
              ...(node.kind === "chunk"
                ? [
                    {
                      label: t("prompt.expandToText"),
                      action: () => {
                        void expand(node).then((result) => {
                          if (
                            latest.current.active &&
                            latest.current.node === node &&
                            result !== node
                          )
                            latest.current.onChange(result);
                        });
                      },
                    },
                    {
                      label: t("prompt.revertOverride"),
                      action: () => onChange({ ...node, overrideText: null }),
                      disabled: node.overrideText === null,
                    },
                  ]
                : []),
              { label: t("prompt.removeSegment"), action: remove, danger: true },
            ]}
          />
        </div>
      </header>
      <PromptTextEditor
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
    </article>
  );
}
