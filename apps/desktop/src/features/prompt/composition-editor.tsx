import { useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Link2, Plus } from "lucide-react";
import type { Composition, PromptNode, Resource } from "@/bindings/workbench";
import { Button, IconButton } from "@/shared/ui";
import { moveItem, textNode } from "./model";
import { NodeEditor } from "./node-editor";
import { ChunkPicker } from "./chunk-picker";

export function CompositionEditor({
  value,
  onChange,
  resources,
  addChunk,
  expandChunk,
  compact = false,
  allowChunk = true,
  toolbarActions,
  model,
}: {
  value: Composition;
  onChange: (value: Composition) => void;
  resources: Map<string, Resource>;
  addChunk?: (scope: "positive" | "negative") => void;
  expandChunk: (node: PromptNode) => Promise<PromptNode>;
  compact?: boolean;
  allowChunk?: boolean;
  toolbarActions?: ReactNode;
  model?: string;
}) {
  const [pickerScope, setPickerScope] = useState<"positive" | "negative" | null>(null);
  const [activeScope, setActiveScope] = useState<"positive" | "negative">("positive");
  const update = (scope: "positive" | "negative", nodes: PromptNode[]) =>
    onChange({ ...value, [scope]: nodes });
  return (
    <Tabs.Root
      value={activeScope}
      onValueChange={(scope) => {
        if (scope === "positive" || scope === "negative") setActiveScope(scope);
      }}
      className={`composition ${compact ? "compact-composition" : ""}`}
    >
      <header className="composition-toolbar">
        <Tabs.List className="prompt-tabs" aria-label="提示词作用域">
          <Tabs.Tab value="positive" data-prompt-tab="positive">
            提示词
          </Tabs.Tab>
          <Tabs.Tab value="negative" data-prompt-tab="negative">
            负面内容
          </Tabs.Tab>
        </Tabs.List>
        <div className="button-group">
          {allowChunk && (
            <IconButton
              label="添加 Chunk"
              onClick={() => (addChunk ? addChunk(activeScope) : setPickerScope(activeScope))}
            >
              <Link2 size={14} />
            </IconButton>
          )}
          <IconButton
            label="添加文本片段"
            onClick={() => update(activeScope, [...value[activeScope], textNode()])}
          >
            <Plus size={14} />
          </IconButton>
          {toolbarActions}
        </div>
      </header>
      {(["positive", "negative"] as const).map((scope) => (
        <Tabs.Panel
          className="prompt-scope"
          key={scope}
          value={scope}
          data-prompt-scope={scope}
          keepMounted
        >
          {value[scope].length === 0 && (
            <div className="scope-empty">
              <Button type="button" className="quiet" onClick={() => update(scope, [textNode()])}>
                <Plus size={14} />
                {scope === "positive" ? "编写正面提示词" : "编写负面提示词"}
              </Button>
            </div>
          )}
          {value[scope].map((node, index) => (
            <NodeEditor
              key={node.id}
              node={node}
              model={model}
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
        </Tabs.Panel>
      ))}
      {pickerScope && (
        <ChunkPicker
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
    </Tabs.Root>
  );
}
