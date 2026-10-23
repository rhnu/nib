import { Plus } from "lucide-react";
import type {
  Draft,
  ModelCapabilities,
  Resource,
  ResolvedDraft,
  VibeEncodingInput,
} from "../../bindings/workbench";
import type { GenerationQuote, ParameterDiagnostic } from "../../bindings/generation";
import { Button, HelpMarker, IconButton } from "../../shared/ui";
import { PresetEditor } from "../prompt/PresetEditor";
import { SettingsEditor } from "../prompt/SettingsEditor";
import { moveItem } from "../prompt/model";
import { ImageOperationPanel } from "./ImageOperationPanel";
import type { ImageOperationAction } from "./image-operation";
import { CharacterListEditor, CharacterPositionPolicy } from "../characters";
import { PreciseReferenceEditor } from "../references";
import { VibeReferenceEditor } from "../vibes";
import type { ScopedOutputIssues } from "./output-issues";
export function ContextRail({
  draft,
  resources,
  models,
  resolved,
  capabilities,
  diagnostics,
  errorFields,
  readCurrentDraft,
  edit,
  onAddPreset,
  setError,
  estimate,
  onRestore,
  onRequestOperation,
  onReturnToText,
  imageInputVersion,
  onEditMask,
  onPosition,
  outputIssues,
  onEncodeVibe,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  models: string[];
  resolved: ResolvedDraft | null;
  capabilities: ModelCapabilities | null;
  diagnostics: ParameterDiagnostic[];
  errorFields: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onAddPreset: () => void;
  setError: (message: string) => void;
  estimate: GenerationQuote | null;
  onRestore: (draft: Draft) => void;
  onRequestOperation: (id: string, kind: ImageOperationAction) => void;
  onReturnToText: () => void;
  imageInputVersion: number;
  onEditMask: (assetId: string) => void;
  onPosition: (characterId?: string, presetInstanceId?: string) => void;
  outputIssues: ScopedOutputIssues;
  onEncodeVibe: (input?: VibeEncodingInput) => void;
}) {
  return (
    <div className="context-rail">
      {draft.inputs.operation.kind !== "upscale" && (
        <section className="preset-context">
          <header className="section-heading">
            <h2>
              配方<span className="count">{draft.presets.length}</span>
              <HelpMarker label="配方帮助">
                配方按顺序应用，随后追加当前提示词。修改链接内容只覆盖当前实例；可在操作菜单中排序或展开为独立配方。
              </HelpMarker>
            </h2>
            <IconButton label="添加 Preset" onClick={onAddPreset}>
              <Plus size={16} />
            </IconButton>
          </header>
          {draft.presets.map((instance, index) => (
            <PresetEditor
              key={instance.id}
              instance={instance}
              resources={resources}
              models={models}
              capabilities={capabilities}
              onPosition={(id) => onPosition(id, instance.id)}
              characterIssues={outputIssues.presets[instance.id]?.characters}
              preciseIssues={outputIssues.presets[instance.id]?.precise}
              vibeIssues={outputIssues.presets[instance.id]?.vibes}
              onChange={(value) => {
                const current = readCurrentDraft();
                if (current)
                  edit({
                    ...current,
                    presets: current.presets.map((item) =>
                      item.id === instance.id ? value : item,
                    ),
                  });
              }}
              onRemove={() =>
                edit({
                  ...draft,
                  presets: draft.presets.filter((item) => item.id !== instance.id),
                })
              }
              up={() => edit({ ...draft, presets: moveItem(draft.presets, index, -1) })}
              down={() => edit({ ...draft, presets: moveItem(draft.presets, index, 1) })}
              canUp={index > 0}
              canDown={index < draft.presets.length - 1}
              onError={setError}
            />
          ))}
        </section>
      )}
      <ImageOperationPanel
        draft={draft}
        capabilities={capabilities}
        estimate={estimate}
        models={models}
        readCurrentDraft={readCurrentDraft}
        edit={edit}
        onRestore={onRestore}
        onError={setError}
        onRequestOperation={onRequestOperation}
        onReturnToText={onReturnToText}
        diagnostics={diagnostics}
        errorFields={errorFields}
        inputVersion={imageInputVersion}
        onEditMask={onEditMask}
      />
      {draft.inputs.operation.kind !== "upscale" && (
        <>
          <section className="settings-context" data-draft-outputs>
            <div data-setting-field="precise">
              <PreciseReferenceEditor
                value={draft.inputs.references.precise}
                onChange={(precise) => {
                  const current = readCurrentDraft();
                  edit({
                    ...current,
                    inputs: {
                      ...current.inputs,
                      references: { ...current.inputs.references, precise },
                    },
                  });
                }}
                capabilities={capabilities}
                contextKey={imageInputVersion}
                issues={outputIssues.draft.precise}
              />
            </div>
            <div data-setting-field="vibes">
              <VibeReferenceEditor
                value={draft.inputs.references.vibes}
                normalizeValue={draft.inputs.references.normalizeVibeStrength}
                onNormalizeChange={(normalizeVibeStrength) => {
                  const current = readCurrentDraft();
                  edit({
                    ...current,
                    inputs: {
                      ...current.inputs,
                      references: { ...current.inputs.references, normalizeVibeStrength },
                    },
                  });
                }}
                onChange={(vibes) => {
                  const current = readCurrentDraft();
                  edit({
                    ...current,
                    inputs: {
                      ...current.inputs,
                      references: { ...current.inputs.references, vibes },
                    },
                  });
                }}
                capabilities={capabilities}
                contextKey={imageInputVersion}
                onEncode={onEncodeVibe}
                issues={outputIssues.draft.vibes}
              />
            </div>
            <div data-setting-field="characters">
              <CharacterListEditor
                value={draft.characters}
                onChange={(characters) => edit({ ...readCurrentDraft(), characters })}
                resources={resources}
                models={models}
                capabilities={capabilities}
                onError={setError}
                onPosition={(id) => onPosition(id)}
                issues={outputIssues.draft.characters}
              />
            </div>
            {Boolean(draft.characters.length || resolved?.characters.length) && (
              <>
                <CharacterPositionPolicy
                  value={draft.settings.useCoords}
                  inherited={estimate?.resolved?.settings.useCoords ?? resolved?.settings.useCoords}
                  onChange={(useCoords) => {
                    const current = readCurrentDraft();
                    edit({ ...current, settings: { ...current.settings, useCoords } });
                  }}
                />
                <div className="button-group">
                  <Button
                    className="quiet"
                    disabled={!capabilities?.characterPositioning}
                    onClick={() => onPosition()}
                  >
                    角色定位
                  </Button>
                </div>
              </>
            )}
          </section>
          <section className="settings-context">
            <header className="section-heading">
              <h2>图像设置</h2>
            </header>
            <SettingsEditor
              fields="image"
              value={draft.settings}
              models={models}
              capabilities={capabilities}
              diagnostics={diagnostics}
              errorFields={errorFields}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...draft, settings })}
            />
          </section>
        </>
      )}
    </div>
  );
}
