import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Link2, Plus } from "lucide-react";
import type { Composition, PromptNode, Resource } from "@/bindings/workbench";
import { Button, IconButton, notify } from "@/shared/ui";
import { ResourcePicker } from "@/features/library/resource-picker";
import { moveItem, textNode } from "./model";
import { NodeEditor } from "./node-editor";
import { promptDragType, usePromptTransfer } from "./prompt-transfer-context";
import { PromptEditorScope, usePromptEditorPath } from "./prompt-editor-state";

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
  negativeSupported = true,
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
  negativeSupported?: boolean;
}) {
  const { i18n } = useTranslation();

  const [pickerScope, setPickerScope] = useState<"positive" | "negative" | null>(null);
  const [activeScope, setActiveScope] = useState<"positive" | "negative">("positive");
  const visibleScope = negativeSupported ? activeScope : "positive";
  const path = usePromptEditorPath();
  const pathKey = JSON.stringify(path);
  const transfer = usePromptTransfer();
  const register = transfer?.register;
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  useEffect(() => {
    if (!register) return;
    const cleanups = (["positive", "negative"] as const)
      .filter((scope) => scope === "positive" || negativeSupported)
      .map((scope) =>
        register(JSON.stringify([...JSON.parse(pathKey), scope]), {
          target: { path: JSON.parse(pathKey) as string[], scope },
          label: `${contextLabel ?? t("prompt.mainPrompt")} · ${scope === "positive" ? t("prompt.positive") : t("prompt.negative")}`,
          allowChunk,
        }),
      );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [register, pathKey, contextLabel, allowChunk, negativeSupported, i18n.resolvedLanguage]);
  if (!negativeSupported) {
    if (activeScope !== "positive") setActiveScope("positive");
    if (pickerScope === "negative") setPickerScope(null);
  }
  const canDrop = Boolean(transfer?.active && (allowChunk || transfer.active.node.kind === "text"));

  const drop = (scope: "positive" | "negative", beforeId?: string) => {
    if (!canDrop || !transfer?.active) return;
    transfer.move(transfer.active.from, { path, scope }, transfer.active.node.id, beforeId);
    transfer.start(null);
    setDropBefore(null);
  };

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
      value={visibleScope}
      onValueChange={(scope) => {
        if (scope === "positive" || (scope === "negative" && negativeSupported))
          setActiveScope(scope);
      }}
      className={`composition ${compact ? "compact-composition" : ""}`}
    >
      <header className="composition-toolbar">
        <Tabs.List className="prompt-tabs" aria-label={t("prompt.scope")}>
          <Tabs.Tab value="positive" data-prompt-tab="positive">
            {t("prompt.prompt")}
          </Tabs.Tab>
          <Tabs.Tab value="negative" data-prompt-tab="negative" disabled={!negativeSupported}>
            {t("prompt.negativeContent")}
          </Tabs.Tab>
        </Tabs.List>
        <div className="button-group">
          {allowChunk && (
            <IconButton label={t("prompt.addChunk")} onClick={() => setPickerScope(visibleScope)}>
              <Link2 size={14} />
            </IconButton>
          )}
          <IconButton
            label={t("prompt.addTextSegment")}
            onClick={() =>
              update(visibleScope, [...latest.current.value[visibleScope], textNode()])
            }
          >
            <Plus size={14} />
          </IconButton>
          {toolbarActions}
        </div>
      </header>
      {(["positive", "negative"] as const)
        .filter((scope) => scope === "positive" || negativeSupported)
        .map((scope) => (
          <Tabs.Panel
            className={`prompt-scope${canDrop && dropBefore === "end" ? " prompt-drop-end" : ""}`}
            onDragOver={(event) => {
              if (!canDrop || !event.dataTransfer.types.includes(promptDragType)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setDropBefore("end");
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDropBefore(null);
            }}
            onDrop={(event) => {
              if (!canDrop) return;
              event.preventDefault();
              event.stopPropagation();
              drop(scope);
            }}
            key={scope}
            value={scope}
            data-prompt-scope={scope}
            keepMounted
          >
            <PromptEditorScope path={[scope]}>
              {value[scope].length === 0 && (
                <div className="scope-empty">
                  <Button
                    type="button"
                    className="quiet"
                    onClick={() => update(scope, [textNode()])}
                  >
                    <Plus size={14} />
                    {scope === "positive"
                      ? t("prompt.writePositivePrompt")
                      : t("prompt.writeNegativePrompt")}
                  </Button>
                </div>
              )}
              {value[scope].map((node, index) => (
                <div
                  key={node.id}
                  className={`prompt-drop-slot${canDrop && dropBefore === node.id ? " prompt-drop-before" : ""}`}
                  onDragOver={(event) => {
                    if (!canDrop || !event.dataTransfer.types.includes(promptDragType)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    const after =
                      event.clientY >
                      event.currentTarget.getBoundingClientRect().top +
                        event.currentTarget.getBoundingClientRect().height / 2;
                    setDropBefore(after ? (value[scope][index + 1]?.id ?? "end") : node.id);
                  }}
                  onDrop={(event) => {
                    if (!canDrop) return;
                    event.preventDefault();
                    event.stopPropagation();
                    drop(scope, dropBefore === "end" ? undefined : (dropBefore ?? node.id));
                  }}
                >
                  <NodeEditor
                    transferTarget={{ path, scope }}
                    node={node}
                    model={model}
                    resource={node.kind === "chunk" ? resources.get(node.resourceId) : undefined}
                    onChange={(next) =>
                      update(
                        scope,
                        latest.current.value[scope].map((item) =>
                          item.id === node.id ? next : item,
                        ),
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
                </div>
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
