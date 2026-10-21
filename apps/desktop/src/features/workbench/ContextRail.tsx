import { Plus } from "lucide-react";
import type { Draft, Resource, ResolvedDraft } from "../../bindings/workbench";
import { IconButton } from "../../shared/ui";
import { PresetEditor } from "../prompt/PresetEditor";
import { SettingsEditor } from "../prompt/SettingsEditor";
import { moveItem } from "../prompt/model";
export function ContextRail({
  draft,
  resources,
  models,
  resolved,
  readCurrentDraft,
  edit,
  onAddPreset,
  setError,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  models: string[];
  resolved: ResolvedDraft | null;
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onAddPreset: () => void;
  setError: (message: string) => void;
}) {
  return (
    <aside className="context-rail">
      <section className="preset-context">
        <header className="section-heading">
          <h2>
            应用的 Preset<span className="count">{draft.presets.length}</span>
          </h2>
          <IconButton label="添加 Preset" onClick={onAddPreset}>
            <Plus size={16} />
          </IconButton>
        </header>
        {draft.presets.length === 0 ? (
          <p className="empty-note">暂无配方。添加 Preset 可复用提示词与默认设置。</p>
        ) : (
          draft.presets.map((instance, index) => (
            <PresetEditor
              key={instance.id}
              instance={instance}
              resources={resources}
              models={models}
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
          ))
        )}
      </section>
      <section className="settings-context">
        <header className="section-heading">
          <h2>生成设置</h2>
        </header>
        <SettingsEditor
          compact
          value={draft.settings}
          models={models}
          resolved={resolved?.settings}
          onChange={(settings) => edit({ ...draft, settings })}
        />
        <p className="help-note">留空继承配方或 SDK 默认。解析面板中可查看生效值与来源。</p>
      </section>
    </aside>
  );
}
