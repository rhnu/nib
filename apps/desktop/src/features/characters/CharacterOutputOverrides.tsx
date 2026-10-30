import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type {
  CharacterComposition,
  CharacterOutputOverride,
  InstanceOverride,
  ModelCapabilities,
  Resource,
} from "../../bindings/workbench";
import { Button, IconButton, Toggle } from "../../shared/ui";
import { PresetOverrides } from "../prompt/PresetOverrides";
import { CharacterPositionFields } from "./CharacterPositionFields";
import { setCharacterOverride, type CharacterIssues } from "./model";
import "./characters.css";

/** A linked recipe keeps only explicit output edits; character order belongs to its definition. */
export function CharacterOutputOverrides({
  value,
  overrides,
  textOverrides,
  onChange,
  onTextChange,
  resources,
  capabilities,
  onPosition,
  name = "配方",
  issues = {},
}: {
  value: CharacterComposition[];
  overrides: CharacterOutputOverride[];
  textOverrides: InstanceOverride[];
  onChange: (value: CharacterOutputOverride[]) => void;
  onTextChange: (value: InstanceOverride) => void;
  resources: Map<string, Resource>;
  capabilities: ModelCapabilities | null;
  onPosition?: (characterId: string) => void;
  name?: string;
  issues?: CharacterIssues;
}) {
  const root = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const latest = useRef({ overrides, onChange });
  useLayoutEffect(() => {
    latest.current = { overrides, onChange };
  }, [overrides, onChange]);
  const update = (
    characterId: string,
    patch: Partial<Omit<CharacterOutputOverride, "characterId">>,
  ) => {
    const previous = latest.current.overrides.find((item) => item.characterId === characterId) ?? {
      characterId,
      enabled: null,
      position: null,
    };
    const next = setCharacterOverride(latest.current.overrides, { ...previous, ...patch });
    latest.current.overrides = next;
    latest.current.onChange(next);
  };
  const stale = overrides.filter(
    (item) => !value.some((character) => character.id === item.characterId),
  );
  return (
    <section className="character-list-editor" ref={root}>
      <header className="character-list-heading">
        <h3>
          角色输出<span className="count">{value.length}</span>
        </h3>
      </header>
      {value.map((character, index) => {
        const local = overrides.find((item) => item.characterId === character.id);
        const fieldIssues = issues[character.id] ?? [];
        return (
          <article
            key={character.id}
            className="character-editor-row"
            data-character-id={character.id}
            data-has-errors={fieldIssues.length > 0 || undefined}
          >
            <header>
              <strong>角色 {index + 1}</strong>
              <span className="spacer" />
              {local && <span className="tag">本次覆盖</span>}
              <Toggle
                label={`启用配方角色 ${index + 1}`}
                checked={local?.enabled ?? character.enabled}
                onChange={(enabled) => update(character.id, { enabled })}
              />
              <IconButton
                label="撤销角色启停与位置覆盖"
                disabled={!local}
                onClick={() => update(character.id, { enabled: null, position: null })}
              >
                <RotateCcw size={14} />
              </IconButton>
              <IconButton
                label={`${collapsed.has(character.id) ? "展开" : "折叠"}配方角色 ${index + 1}`}
                data-character-expand
                aria-expanded={!collapsed.has(character.id)}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(character.id)) next.delete(character.id);
                    else next.add(character.id);
                    return next;
                  })
                }
              >
                {collapsed.has(character.id) ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </IconButton>
            </header>
            {fieldIssues.map((issue, index) => (
              <p role="alert" className="inline-warning" key={index}>
                {issue.message}
              </p>
            ))}
            <div
              className="character-body"
              hidden={collapsed.has(character.id) && fieldIssues.length === 0}
            >
              <div className="character-prompts">
                <PresetOverrides
                  composition={character.composition}
                  overrides={textOverrides}
                  resources={resources}
                  model={capabilities?.model}
                  name={`${name} 角色 ${index + 1}`}
                  onChange={onTextChange}
                  errorScopes={fieldIssues
                    .filter((issue) => issue.field === "positive" || issue.field === "negative")
                    .map((issue) => issue.field)}
                />
              </div>
              {!onPosition && (
                <CharacterPositionFields
                  value={local?.position ?? character.position}
                  onChange={(position) => update(character.id, { position })}
                  capabilities={capabilities}
                  onRestore={() => update(character.id, { position: null })}
                  overridden={local?.position !== null && local?.position !== undefined}
                  issues={fieldIssues}
                />
              )}
            </div>
          </article>
        );
      })}
      {stale.map((item) => (
        <div
          className="character-stale-override"
          data-character-id={item.characterId}
          key={item.characterId}
        >
          <span>
            已移除角色的覆盖 <code>{item.characterId}</code>
          </span>
          <Button onClick={() => update(item.characterId, { enabled: null, position: null })}>
            移除失效覆盖
          </Button>
        </div>
      ))}
    </section>
  );
}
