import { useState } from "react";
import { Link2, Plus, Type } from "lucide-react";
import type { Composition, PromptNode, Resource } from "../../bindings/workbench";
import { Button } from "../../shared/ui";
import { moveItem, textNode } from "./model";
import { NodeEditor } from "./NodeEditor";
import { ChunkPicker } from "./ChunkPicker";

export function CompositionEditor({
  value,
  onChange,
  resources,
  addChunk,
  expandChunk,
  compact = false,
  allowChunk = true,
}: {
  value: Composition;
  onChange: (value: Composition) => void;
  resources: Map<string, Resource>;
  addChunk?: (scope: "positive" | "negative") => void;
  expandChunk: (node: PromptNode) => Promise<PromptNode>;
  compact?: boolean;
  allowChunk?: boolean;
}) {
  const [pickerScope, setPickerScope] = useState<"positive" | "negative" | null>(null);
  const update = (scope: "positive" | "negative", nodes: PromptNode[]) =>
    onChange({ ...value, [scope]: nodes });
  return (
    <div className={`composition ${compact ? "compact-composition" : ""}`}>
      {(["positive", "negative"] as const).map((scope) => (
        <section className="prompt-scope" key={scope}>
          <header className="section-heading">
            <h2>
              {scope === "positive" ? "基础提示" : "负面提示"}
              <span className="count">{value[scope].length}</span>
            </h2>
            <div className="button-group">
              {allowChunk && (
                <Button
                  type="button"
                  className="quiet"
                  onClick={() => (addChunk ? addChunk(scope) : setPickerScope(scope))}
                >
                  <Link2 size={14} />
                  添加 Chunk
                </Button>
              )}
              <Button
                type="button"
                className="quiet"
                onClick={() => update(scope, [...value[scope], textNode()])}
              >
                <Plus size={14} />
                文本
              </Button>
            </div>
          </header>
          {value[scope].length === 0 && (
            <div className="scope-empty">
              <Type size={19} />
              <p>
                {scope === "positive"
                  ? "用文本描写画面，或添加可复用的 Chunk。"
                  : "添加希望排除的内容。"}
              </p>
              <Button type="button" onClick={() => update(scope, [textNode()])}>
                开始编写
              </Button>
            </div>
          )}
          {value[scope].map((node, index) => (
            <NodeEditor
              key={node.id}
              node={node}
              resource={node.kind === "chunk" ? resources.get(node.resourceId) : undefined}
              onChange={(next) =>
                update(
                  scope,
                  value[scope].map((item) => (item.id === node.id ? next : item)),
                )
              }
              up={() => update(scope, moveItem(value[scope], index, -1))}
              down={() => update(scope, moveItem(value[scope], index, 1))}
              canUp={index > 0}
              canDown={index < value[scope].length - 1}
              remove={() =>
                update(
                  scope,
                  value[scope].filter((item) => item.id !== node.id),
                )
              }
              expand={expandChunk}
            />
          ))}
        </section>
      ))}
      {pickerScope && (
        <ChunkPicker
          resources={resources}
          onClose={() => setPickerScope(null)}
          onChoose={(resourceId) => {
            update(pickerScope, [
              ...value[pickerScope],
              {
                kind: "chunk",
                id: crypto.randomUUID(),
                enabled: true,
                resourceId,
                overrideText: null,
              },
            ]);
            setPickerScope(null);
          }}
        />
      )}
    </div>
  );
}
