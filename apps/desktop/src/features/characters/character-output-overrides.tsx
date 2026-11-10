import { Row, Button, IconButton, Toggle } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type {
  CharacterComposition,
  CharacterOutputOverride,
  InstanceOverride,
  ModelCapabilities,
  Resource,
} from "@/bindings/workbench";

import { PresetOverrides } from "@/features/prompt/preset-overrides";
import { PromptEditorScope } from "@/features/prompt/prompt-editor-state";
import { CharacterPositionFields } from "./character-position-fields";
import { setCharacterOverride, type CharacterIssues } from "./model";

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
  name = t("characters.recipe"),
  issues = {},
  tokenIndicator,
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
  tokenIndicator?: (characterId: string, index: number) => ReactNode;
}) {
  useTranslation();

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
    <section className="character-list-editor min-w-0 mt-space-2" ref={root}>
      <header className="character-list-heading flex items-center gap-space-2 min-w-0 [&_h3]:m-0 justify-between mb-[7px]">
        <h3>
          {t("characters.output")}
          <span className="count ml-space-3 text-caption text-muted font-[450]">
            {value.length}
          </span>
        </h3>
      </header>
      {value.map((character, index) => {
        const local = overrides.find((item) => item.characterId === character.id);
        const fieldIssues = issues[character.id] ?? [];
        return (
          <article
            key={character.id}
            className="character-editor-row [&_>_header]:flex [&_>_header]:items-center [&_>_header]:gap-space-2 [&_>_header]:min-w-0 [&_>_header]:min-h-[28px] [&_>_header_>_strong]:text-label [&_>_header_>_strong]:font-[550] [border-top:1px_solid_var(--line-subtle)] p-[7px_0] min-w-0"
            data-character-id={character.id}
            data-has-errors={fieldIssues.length > 0 || undefined}
          >
            <header>
              <strong>
                {t("characters.characterNumber")}
                {index + 1}
              </strong>
              {tokenIndicator?.(character.id, index)}
              <span className="flex-1" />
              {local && (
                <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
                  {t("characters.currentOverride")}
                </span>
              )}
              <Toggle
                label={t("characters.enableRecipeCharacter", { value0: index + 1 })}
                checked={local?.enabled ?? character.enabled}
                onChange={(enabled) => update(character.id, { enabled })}
              />
              <IconButton
                label={t("characters.resetStateOverrides")}
                disabled={!local}
                onClick={() => update(character.id, { enabled: null, position: null })}
              >
                <RotateCcw size={14} />
              </IconButton>
              <IconButton
                label={t("characters.toggleRecipeExpanded", {
                  value0: collapsed.has(character.id)
                    ? t("characters.expand")
                    : t("characters.collapse"),
                  value1: index + 1,
                })}
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
              <p
                role="alert"
                className="inline-warning text-danger text-label leading-[1.7]"
                key={index}
              >
                {issue.message}
              </p>
            ))}
            <div
              className="character-body [&[hidden]]:hidden"
              hidden={collapsed.has(character.id) && fieldIssues.length === 0}
            >
              <div className="character-prompts [&_>_section_h3]:m-[8px_0_5px] [&_>_section_h3]:text-caption [&_>_section_h3]:font-medium [&_>_section_h3]:text-muted [&_.prompt-node]:mb-[5px] [&_.composition-toolbar]:mb-[5px] m-[7px_0]">
                <PromptEditorScope path={["character", character.id]}>
                  <PresetOverrides
                    negativeSupported={capabilities?.customNegativePrompts}
                    composition={character.composition}
                    overrides={textOverrides}
                    resources={resources}
                    model={capabilities?.model}
                    name={t("characters.namedCharacter", { value0: name, value1: index + 1 })}
                    onChange={onTextChange}
                    errorScopes={fieldIssues
                      .filter((issue) => issue.field === "positive" || issue.field === "negative")
                      .map((issue) => issue.field)}
                  />
                </PromptEditorScope>
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
        <Row
          gap={0}
          className="character-stale-override [&_code]:wrap-anywhere flex items-center flex-wrap gap-space-3 m-[8px_0] text-danger"
          data-character-id={item.characterId}
          key={item.characterId}
        >
          <span>
            {t("characters.removedOverride")}
            <code>{item.characterId}</code>
          </span>
          <Button onClick={() => update(item.characterId, { enabled: null, position: null })}>
            {t("characters.removeStaleOverride")}
          </Button>
        </Row>
      ))}
    </section>
  );
}
