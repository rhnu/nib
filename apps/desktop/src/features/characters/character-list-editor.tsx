import { t, useTranslation } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { CharacterComposition, ModelCapabilities, Resource } from "@/bindings/workbench";
import { IconButton, Toggle } from "@/shared/ui";
import { CompositionEditor } from "@/features/prompt/composition-editor";
import { promptApi } from "@/features/prompt/api";
import { moveItem } from "@/features/prompt/model";
import { CharacterPositionFields } from "./character-position-fields";
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
  capabilities: ModelCapabilities | null;
  onError: (message: unknown) => void;
  onPosition?: (characterId: string) => void;
  allowChunk?: boolean;
  title?: string;
  issues?: CharacterIssues;
};

function CharacterRow({
  character,
  index,
  resources,
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
  useTranslation();

  const root = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const textIssue = fieldIssues.find(
    (issue) => issue.field === "positive" || issue.field === "negative",
  )?.field;
  const isCollapsed = collapsed && fieldIssues.length === 0;
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
        <strong>
          {t("characters.characterNumber")}
          {index + 1}
        </strong>
        <span className="spacer" />
        <IconButton
          label={t("characters.moveUp", { value0: index + 1 })}
          disabled={!actions.canUp}
          onClick={actions.up}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          label={t("characters.moveDown", { value0: index + 1 })}
          disabled={!actions.canDown}
          onClick={actions.down}
        >
          <ArrowDown size={14} />
        </IconButton>
        <Toggle
          label={t("characters.enable", { value0: index + 1 })}
          checked={character.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <IconButton label={t("characters.remove", { value0: index + 1 })} onClick={actions.remove}>
          <Trash2 size={14} />
        </IconButton>
        <IconButton
          label={t("characters.toggleExpanded", {
            value0: isCollapsed ? t("characters.expand") : t("characters.collapse"),
            value1: index + 1,
          })}
          data-character-expand
          aria-expanded={!isCollapsed}
          onClick={() => setCollapsed(!isCollapsed)}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </IconButton>
      </header>
      {fieldIssues.map((issue, index) => (
        <p className="inline-warning" role="alert" key={index}>
          {issue.message}
        </p>
      ))}
      <div className="character-body" hidden={isCollapsed}>
        <div className="character-prompts">
          <CompositionEditor
            compact
            value={character.composition}
            resources={resources}
            model={capabilities?.model}
            allowChunk={allowChunk}
            onChange={(composition) => update({ composition })}
            expandChunk={async (node) => {
              try {
                return await promptApi.expandChunk(node);
              } catch (cause) {
                onError(cause);
                return node;
              }
            }}
          />
        </div>
        {!onPosition && (
          <CharacterPositionFields
            value={character.position}
            onChange={(position) => update({ position })}
            capabilities={capabilities}
            issues={fieldIssues}
          />
        )}
      </div>
    </article>
  );
}

/** Ordered character definitions retain their IDs, scope nodes and local editor state. */
export function CharacterListEditor({
  value,
  onChange,
  resources,
  capabilities,
  onError,
  onPosition,
  allowChunk = true,
  title = t("characters.characters"),
  issues = {},
}: EditorProps) {
  useTranslation();

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
          label={t("characters.add")}
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
          {t("characters.enabledLimit", { count: enabled, maximum: max })}
        </p>
      )}
      {capabilities?.maxCharacters === 0 && value.length > 0 && (
        <p className="inline-warning">{t("characters.unsupported")}</p>
      )}
      {!capabilities && value.length > 0 && (
        <output className="muted">{t("characters.capabilitiesNotLoaded")}</output>
      )}
      {value.map((character, index) => (
        <CharacterRow
          key={character.id}
          character={character}
          index={index}
          resources={resources}
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
