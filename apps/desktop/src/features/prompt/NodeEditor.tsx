import { useEffect, useLayoutEffect, useRef } from "react";
import { Link2, Type } from "lucide-react";
import type { PromptNode, Resource } from "../../bindings/workbench";
import { ActionsMenu, Toggle } from "../../shared/ui";

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
}) {
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
    <article className={`prompt-node ${node.enabled ? "" : "node-disabled"}`}>
      <header className="node-heading">
        <span className="node-label">
          {node.kind === "chunk" ? <Link2 size={14} /> : <Type size={14} />}
          {node.kind === "chunk" ? (resource?.name ?? "资源缺失") : "文本"}
        </span>
        <div className="button-group">
          {node.kind === "chunk" && node.overrideText !== null && (
            <span className="tag">本次覆盖</span>
          )}
          <Toggle
            checked={node.enabled}
            label="启用片段"
            onChange={(enabled) => onChange({ ...node, enabled })}
          />
          <ActionsMenu
            label="片段操作"
            items={[
              { label: "上移", action: up, disabled: !canUp },
              { label: "下移", action: down, disabled: !canDown },
              ...(node.kind === "chunk"
                ? [
                    {
                      label: "展开为独立文本",
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
                      label: "撤销本次覆盖",
                      action: () => onChange({ ...node, overrideText: null }),
                      disabled: node.overrideText === null,
                    },
                  ]
                : []),
              { label: "移除片段", action: remove, danger: true },
            ]}
          />
        </div>
      </header>
      <textarea
        aria-label={
          node.kind === "text" ? "提示词文本" : `${resource?.name ?? "缺失 Chunk"} 的本次内容`
        }
        spellCheck={false}
        value={node.kind === "text" ? node.text : (node.overrideText ?? sourceText)}
        placeholder={
          node.kind === "text"
            ? "输入提示词…"
            : resource
              ? "此 Chunk 内容为空"
              : "引用的资源不存在；可移除引用或恢复原资源。"
        }
        onChange={(event) =>
          onChange(
            node.kind === "text"
              ? { ...node, text: event.target.value }
              : { ...node, overrideText: event.target.value },
          )
        }
      />
    </article>
  );
}
