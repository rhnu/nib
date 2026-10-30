import type { Draft, ModelCapabilities, Resource, ResolvedDraft } from "@/bindings/workbench";
import { CharacterListEditor, CharacterPositionPolicy } from "@/features/characters";
import { PresetEditor } from "@/features/prompt/preset-editor";
import { moveItem } from "@/features/prompt/model";
import type { ScopedOutputIssues } from "./output-issues";

/** Character edits stay beside the prompt while linked recipe edits remain instance overrides. */
export function CharacterContext({
  draft,
  resources,
  models,
  resolved,
  capabilities,
  readCurrentDraft,
  edit,
  setError,
  onPosition,
  outputIssues,
  inheritedUseCoords,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  models: string[];
  resolved: ResolvedDraft | null;
  capabilities: ModelCapabilities | null;
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  setError: (message: string) => void;
  onPosition: (characterId?: string, presetInstanceId?: string) => void;
  outputIssues: ScopedOutputIssues;
  inheritedUseCoords?: boolean | null;
}) {
  const count =
    draft.characters.length +
    draft.presets.reduce((total, instance) => {
      const binding = instance.binding;
      if (binding.kind === "expanded") return total + binding.characters.length;
      const resource = resources.get(binding.resourceId);
      return total + (resource?.content.kind === "preset" ? resource.content.characters.length : 0);
    }, 0);
  return (
    <section className="character-context" data-draft-outputs data-setting-field="characters">
      {count >= 2 && (
        <CharacterPositionPolicy
          value={draft.settings.useCoords}
          inherited={inheritedUseCoords ?? resolved?.settings.useCoords}
          disabled={!capabilities?.characterPositioning}
          onPosition={() => onPosition()}
          onChange={(useCoords) => {
            const current = readCurrentDraft();
            edit({ ...current, settings: { ...current.settings, useCoords } });
          }}
        />
      )}
      {draft.presets.map((instance, index) => (
        <PresetEditor
          key={instance.id}
          part="characters"
          instance={instance}
          resources={resources}
          models={models}
          capabilities={capabilities}
          onPosition={(id) => onPosition(id, instance.id)}
          characterIssues={outputIssues.presets[instance.id]?.characters}
          onChange={(value) => {
            const current = readCurrentDraft();
            edit({
              ...current,
              presets: current.presets.map((item) => (item.id === instance.id ? value : item)),
            });
          }}
          onRemove={() => {
            const current = readCurrentDraft();
            edit({
              ...current,
              presets: current.presets.filter((item) => item.id !== instance.id),
            });
          }}
          up={() =>
            edit({
              ...readCurrentDraft(),
              presets: moveItem(readCurrentDraft().presets, index, -1),
            })
          }
          down={() =>
            edit({ ...readCurrentDraft(), presets: moveItem(readCurrentDraft().presets, index, 1) })
          }
          canUp={index > 0}
          canDown={index < draft.presets.length - 1}
          onError={setError}
        />
      ))}
      <CharacterListEditor
        value={draft.characters}
        onChange={(characters) => edit({ ...readCurrentDraft(), characters })}
        resources={resources}
        capabilities={capabilities}
        onError={setError}
        onPosition={(id) => onPosition(id)}
        issues={outputIssues.draft.characters}
      />
    </section>
  );
}
