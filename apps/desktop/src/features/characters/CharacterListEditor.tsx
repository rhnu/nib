import { useEffect, useLayoutEffect, useRef } from "react";
import { Plus } from "lucide-react";
import type { CharacterComposition, ModelCapabilities, Resource } from "../../bindings/workbench";
import { ActionsMenu, IconButton, Toggle } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { promptApi } from "../prompt/api";
import { moveItem } from "../prompt/model";
import { CharacterPositionFields } from "./CharacterPositionFields";
import {
  createCharacter,
  patchCharacter,
  type CharacterFieldIssue,
  type CharacterIssues,
} from "./model";
import "./characters.css";

type EditorProps = {
  value: CharacterComposition[];
  onChange: (value: CharacterComposition[]) => void;
  resources: Map<string, Resource>;
  models: string[];
  capabilities: ModelCapabilities | null;
  onError: (message: string) => void;
  onPosition?: (characterId: string) => void;
  allowChunk?: boolean;
  title?: string;
  issues?: CharacterIssues;
};

function CharacterRow({
  character,
  index,
  resources,
  models,
  capabilities,
  onError,
  onPosition,
  allowChunk,
  update,
  actions,
  fieldIssues,
}: Omit<EditorProps, "value" | "onChange" | "title" | "issues"> & {
  character: CharacterComposition;
  index: number;
  update: (patch: Partial<Omit<CharacterComposition, "id">>) => void;
  actions: {
    canUp: boolean;
    canDown: boolean;
    up: () => void;
    down: () => void;
    remove: () => void;
  };
  fieldIssues: CharacterFieldIssue[];
}) {
  const root = useRef<HTMLElement>(null);
  const textIssue = fieldIssues.find(
    (issue) => issue.field === "positive" || issue.field === "negative",
  )?.field;
  const signature = fieldIssues.map((issue) => `${issue.field}:${issue.message}`).join("|");
  useEffect(() => {
    if (!textIssue) return;
    root.current?.querySelector<HTMLElement>(`[data-prompt-tab="${textIssue}"]`)?.click();
  }, [signature, textIssue]);
  return (
    <article
      ref={root}
      className={`character-editor-row ${character.enabled ? "" : "character-disabled"}`}
      data-character-id={character.id}
      data-has-errors={fieldIssues.length > 0 || undefined}
    >
      <header>
        <strong>角色 {index + 1}</strong>
        <span className="spacer" />
        <Toggle
          label={`启用角色 ${index + 1}`}
          checked={character.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <ActionsMenu
          label={`角色 ${index + 1} 操作`}
          items={[
            { label: "上移", action: actions.up, disabled: !actions.canUp },
            { label: "下移", action: actions.down, disabled: !actions.canDown },
            { label: "移除角色", action: actions.remove, danger: true },
          ]}
        />
      </header>
      {fieldIssues.map((issue, index) => (
        <p className="inline-warning" role="alert" key={index}>
          {issue.message}
        </p>
      ))}
      <div className="character-prompts">
        <CompositionEditor
          compact
          value={character.composition}
          resources={resources}
          models={models}
          model={capabilities?.model}
          allowChunk={allowChunk}
          onChange={(composition) => update({ composition })}
          expandChunk={async (node) => {
            try {
              return await promptApi.expandChunk(node);
            } catch (cause) {
              onError(errorMessage(cause));
              return node;
            }
          }}
        />
      </div>
      <CharacterPositionFields
        value={character.position}
        onChange={(position) => update({ position })}
        capabilities={capabilities}
        onPosition={onPosition ? () => onPosition(character.id) : undefined}
        issues={fieldIssues}
      />
    </article>
  );
}

/** Ordered character definitions retain their IDs, scope nodes and local editor state. */
export function CharacterListEditor({
  value,
  onChange,
  resources,
  models,
  capabilities,
  onError,
  onPosition,
  allowChunk = true,
  title = "角色",
  issues = {},
}: EditorProps) {
  const latest = useRef({ value, onChange });
  useLayoutEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);
  const emit = (next: CharacterComposition[]) => {
    latest.current.value = next;
    latest.current.onChange(next);
  };
  const enabled = value.filter((character) => character.enabled).length;
  const max = capabilities?.maxCharacters ?? 0;
  return (
    <section className="character-list-editor">
      <header className="character-list-heading">
        <h3>
          {title}
          <span className="count">
            {enabled}
            {capabilities ? ` / ${max}` : ""}
          </span>
        </h3>
        <IconButton
          label="添加角色"
          disabled={!capabilities || max === 0 || enabled >= max}
          onClick={() => {
            if (!capabilities) return;
            const character = createCharacter(
              capabilities.characterPositionOptions.defaultPosition,
            );
            emit([...latest.current.value, character]);
          }}
        >
          <Plus size={14} />
        </IconButton>
      </header>
      {capabilities && max > 0 && enabled > max && (
        <p className="inline-warning">
          已启用 {enabled} 个角色，当前模型上限为 {max}。
        </p>
      )}
      {capabilities?.maxCharacters === 0 && value.length > 0 && (
        <p className="inline-warning">当前模型不支持角色提示，已保留角色内容。</p>
      )}
      {!capabilities && value.length > 0 && <output className="muted">角色能力尚未加载。</output>}
      {value.map((character, index) => (
        <CharacterRow
          key={character.id}
          character={character}
          index={index}
          resources={resources}
          models={models}
          capabilities={capabilities}
          onError={onError}
          onPosition={onPosition}
          allowChunk={allowChunk}
          fieldIssues={issues[character.id] ?? []}
          update={(patch) => emit(patchCharacter(latest.current.value, character.id, patch))}
          actions={{
            canUp: index > 0,
            canDown: index < value.length - 1,
            up: () => {
              const current = latest.current.value;
              emit(
                moveItem(
                  current,
                  current.findIndex((item) => item.id === character.id),
                  -1,
                ),
              );
            },
            down: () => {
              const current = latest.current.value;
              emit(
                moveItem(
                  current,
                  current.findIndex((item) => item.id === character.id),
                  1,
                ),
              );
            },
            remove: () => emit(latest.current.value.filter((item) => item.id !== character.id)),
          }}
        />
      ))}
    </section>
  );
}
