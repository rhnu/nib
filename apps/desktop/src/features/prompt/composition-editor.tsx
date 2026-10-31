import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Link2, Plus } from "lucide-react";
import type { Composition, PromptNode, Resource } from "@/bindings/workbench";
import { Button, IconButton, notify } from "@/shared/ui";
import { ResourcePicker } from "@/features/library/resource-picker";
import { moveItem, textNode } from "./model";
import { NodeEditor } from "./node-editor";
import { PromptEditorScope } from "./prompt-editor-state";

export function CompositionEditor({
  value,
  onChange,
  resources,
  expandChunk,
  compact = false,
  allowChunk = true,
  toolbarActions,
  model,
  contextLabel,
}: {
  value: Composition;
  onChange: (value: Composition) => void;
  resources: Map<string, Resource>;
  expandChunk: (node: PromptNode) => Promise<PromptNode>;
  compact?: boolean;
  allowChunk?: boolean;
  toolbarActions?: ReactNode;
  model?: string;
  contextLabel?: string;
}) {
  useTranslation();

  const [pickerScope, setPickerScope] = useState<"positive" | "negative" | null>(null);
  const [activeScope, setActiveScope] = useState<"positive" | "negative">("positive");
  // A picker or an async node expansion must merge into the latest composition.
  const latest = useRef({ value, onChange });
  useLayoutEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);

  const update = (scope: "positive" | "negative", nodes: PromptNode[]) => {
    const next = { ...latest.current.value, [scope]: nodes };
    latest.current.value = next;
    latest.current.onChange(next);
  };

  return (
    <Tabs.Root
      value={activeScope}
      onValueChange={(scope) => {
        if (scope === "positive" || scope === "negative") setActiveScope(scope);
      }}
      className={`composition ${compact ? "compact-composition" : ""}`}
    >
      <header className="composition-toolbar">
        <Tabs.List className="prompt-tabs" aria-label={t("prompt.scope")}>
          <Tabs.Tab value="positive" data-prompt-tab="positive">
            {t("prompt.prompt")}
          </Tabs.Tab>
          <Tabs.Tab value="negative" data-prompt-tab="negative">
            {t("prompt.negativeContent")}
          </Tabs.Tab>
        </Tabs.List>
        <div className="button-group">
          {allowChunk && (
            <IconButton label={t("prompt.addChunk")} onClick={() => setPickerScope(activeScope)}>
              <Link2 size={14} />
            </IconButton>
          )}
          <IconButton
            label={t("prompt.addTextSegment")}
            onClick={() => update(activeScope, [...latest.current.value[activeScope], textNode()])}
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
          <PromptEditorScope path={[scope]}>
            {value[scope].length === 0 && (
              <div className="scope-empty">
                <Button type="button" className="quiet" onClick={() => update(scope, [textNode()])}>
                  <Plus size={14} />
                  {scope === "positive"
                    ? t("prompt.writePositivePrompt")
                    : t("prompt.writeNegativePrompt")}
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
                    latest.current.value[scope].map((item) => (item.id === node.id ? next : item)),
                  )
                }
                up={() => {
                  const nodes = latest.current.value[scope];
                  update(
                    scope,
                    moveItem(
                      nodes,
                      nodes.findIndex((item) => item.id === node.id),
                      -1,
                    ),
                  );
                }}
                down={() => {
                  const nodes = latest.current.value[scope];
                  update(
                    scope,
                    moveItem(
                      nodes,
                      nodes.findIndex((item) => item.id === node.id),
                      1,
                    ),
                  );
                }}
                canUp={index > 0}
                canDown={index < value[scope].length - 1}
                remove={() =>
                  update(
                    scope,
                    latest.current.value[scope].filter((item) => item.id !== node.id),
                  )
                }
                expand={expandChunk}
              />
            ))}
          </PromptEditorScope>
        </Tabs.Panel>
      ))}
      {pickerScope && (
        <ResourcePicker
          kind="chunk"
          model={model}
          contextLabel={`${contextLabel ?? t("prompt.mainPrompt")} · ${
            pickerScope === "positive" ? t("prompt.positive") : t("prompt.negative")
          }`}
          onClose={() => setPickerScope(null)}
          onChoose={(resource) => {
            update(pickerScope, [
              ...latest.current.value[pickerScope],
              {
                kind: "chunk",
                id: crypto.randomUUID(),
                enabled: true,
                resourceId: resource.id,
                overrideText: null,
              },
            ]);
            notify(() => t("library.resourceInserted", { name: resource.name }));
            setPickerScope(null);
          }}
        />
      )}
    </Tabs.Root>
  );
}
