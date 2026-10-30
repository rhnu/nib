import { useState } from "react";
import type {
  InputProvenance,
  PreciseReferenceInput,
  ResolvedCharacter,
  ResolvedDraft,
} from "@/bindings/workbench";
import { Button, Notice } from "@/shared/ui";
import { AssetImage, useMediaAsset } from "@/features/media";
import { imageName } from "@/features/media/model";
import { PromptTextEditor } from "./prompt-text-editor";
import { ContentSources } from "./resolution-sources";
import "./resolved-outputs.css";
import { ResolvedVibes } from "@/features/vibes";

function OutputSource({ source }: { source: InputProvenance | ResolvedCharacter | undefined }) {
  if (!source) return <p className="muted">来源未记录</p>;
  return (
    <dl className="resolved-output-metadata">
      <div>
        <dt>来源</dt>
        <dd>
          {source.presetInstanceId ? "配方输出" : "当前创作"}
          {source.expanded ? " · 已展开" : ""}
          {source.overridden ? " · 实例覆盖" : ""}
        </dd>
      </div>
    </dl>
  );
}

function ResolvedCharacterDetails({
  character,
  index,
  model,
  useCoords,
}: {
  character: ResolvedCharacter;
  index: number;
  model: string;
  useCoords: boolean | null;
}) {
  return (
    <article className="resolved-output-item">
      <header>
        <h4>角色 {index + 1}</h4>
        <span className="tag">{character.enabled ? "启用" : "停用"}</span>
      </header>
      <dl className="resolved-output-metadata">
        <div>
          <dt>{useCoords === true ? "自定义坐标" : "保留坐标"}</dt>
          <dd>
            X {character.position.x} · Y {character.position.y}
          </dd>
        </div>
      </dl>
      <h5>正面提示</h5>
      <PromptTextEditor
        label="角色正面提示"
        value={character.positive}
        model={model}
        readOnly
        placeholder="（空）"
      />
      <h5>负面提示</h5>
      <PromptTextEditor
        label="角色负面提示"
        value={character.negative}
        model={model}
        readOnly
        placeholder="（空）"
      />
      <details>
        <summary>角色内容来源</summary>
        <OutputSource source={character} />
        <ContentSources fragments={character.fragments} model={model} />
      </details>
    </article>
  );
}

function ReferenceMaterial({ id }: { id: string }) {
  const media = useMediaAsset(id);
  if (media.error)
    return <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>{media.error}</Notice>;
  if (!media.asset) return <output>正在读取参考材料…</output>;
  return (
    <div className="resolved-reference-material">
      <p className="muted">{imageName(media.asset)}</p>
      <AssetImage asset={media.asset} alt="精确参考材料" className="resolved-reference-image" />
    </div>
  );
}

const referenceTypes: Record<string, string> = {
  character: "角色",
  style: "风格",
  "character&style": "角色与风格",
  costume: "服装",
  delta: "差异",
};
function ResolvedReferenceDetails({
  reference,
  index,
  source,
}: {
  reference: PreciseReferenceInput;
  index: number;
  source: InputProvenance | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className="resolved-output-item">
      <header>
        <h4>精确参考 {index + 1}</h4>
        <span className="tag">{reference.enabled ? "启用" : "停用"}</span>
      </header>
      <dl className="resolved-output-metadata">
        <div>
          <dt>用途</dt>
          <dd>{referenceTypes[reference.referenceType] ?? reference.referenceType}</dd>
        </div>
        <div>
          <dt>强度</dt>
          <dd>{reference.strength}</dd>
        </div>
        <div>
          <dt>Fidelity</dt>
          <dd>{reference.fidelity}</dd>
        </div>
        <div>
          <dt>信息提取量</dt>
          <dd>{reference.informationExtracted}</dd>
        </div>
      </dl>
      <OutputSource source={source} />
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>查看参考材料</summary>
        {open && <ReferenceMaterial id={reference.assetId} />}
      </details>
    </article>
  );
}

/** Resolved and frozen details consume the same retained facts, without live resource lookups. */
export function ResolvedOutputs({
  resolved,
  tokenModel = resolved.settings.model,
}: {
  resolved: ResolvedDraft;
  tokenModel?: string;
}) {
  if (
    !resolved.characters.length &&
    !resolved.inputs.references.precise.length &&
    !resolved.inputs.references.vibes.length
  )
    return null;
  return (
    <div className="resolved-outputs">
      <ResolvedVibes resolved={resolved} />
      {resolved.characters.length > 0 && (
        <section>
          <h3>角色 · {resolved.characters.length}</h3>
          <p className="muted">
            全局定位：
            {resolved.settings.useCoords === true
              ? "自定义"
              : resolved.settings.useCoords === false
                ? "自动"
                : "按角色位置"}
          </p>
          {resolved.characters.map((character, index) => (
            <ResolvedCharacterDetails
              key={character.id}
              character={character}
              index={index}
              model={tokenModel}
              useCoords={resolved.settings.useCoords}
            />
          ))}
        </section>
      )}
      {resolved.inputs.references.precise.length > 0 && (
        <section>
          <h3>精确参考 · {resolved.inputs.references.precise.length}</h3>
          {resolved.inputs.references.precise.map((reference, index) => (
            <ResolvedReferenceDetails
              key={reference.id}
              reference={reference}
              index={index}
              source={resolved.inputSources.find((source) => source.id === reference.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
