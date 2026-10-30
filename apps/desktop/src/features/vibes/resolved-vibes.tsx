import { useState } from "react";
import type { ResolvedDraft } from "@/bindings/workbench";
import { AssetImage, useMediaAsset } from "@/features/media";
import { VibeAssetDetails } from "./vibe-asset-details";
import "./vibes.css";

function ImageMaterial({ id }: { id: string }) {
  const media = useMediaAsset(id);
  return media.asset ? (
    <AssetImage asset={media.asset} alt="氛围转移原图" className="vibe-thumbnail" />
  ) : (
    <output>{media.error ?? "正在读取原图…"}</output>
  );
}

function CollapsedImageMaterial({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>查看原图</summary>
      {open && <ImageMaterial id={id} />}
    </details>
  );
}

export function ResolvedVibes({ resolved }: { resolved: ResolvedDraft }) {
  const references = resolved.inputs.references;
  if (!references.vibes.length) return null;
  return (
    <section className="resolved-vibes">
      <h3>氛围转移 · {references.vibes.length}</h3>
      <p className="vibe-status">
        强度归一化：
        {references.normalizeVibeStrength === null
          ? "默认"
          : references.normalizeVibeStrength
            ? "开启"
            : "关闭"}
      </p>
      {references.vibes.map((reference, index) => {
        const source = resolved.inputSources.find((item) => item.id === reference.id);
        return (
          <article className="vibe-row" key={reference.id}>
            <header>
              <h4>氛围转移 {index + 1}</h4>
              <span className="tag">{reference.enabled ? "启用" : "停用"}</span>
            </header>
            <dl className="vibe-identity">
              <div>
                <dt>强度</dt>
                <dd>{reference.strength}</dd>
              </div>
              <div>
                <dt>材料</dt>
                <dd>{reference.input.kind === "image" ? "原图" : "编码"}</dd>
              </div>
              {reference.input.kind === "image" && (
                <div>
                  <dt>信息提取量</dt>
                  <dd>{reference.input.informationExtracted}</dd>
                </div>
              )}
              <div>
                <dt>来源</dt>
                <dd>
                  {source?.presetInstanceId ? "配方输出" : "当前创作"}
                  {source?.expanded && " · 已展开"}
                  {source?.overridden && " · 实例覆盖"}
                </dd>
              </div>
            </dl>
            {reference.input.kind === "encoded" ? (
              <VibeAssetDetails id={reference.input.assetId} />
            ) : (
              <CollapsedImageMaterial id={reference.input.assetId} />
            )}
          </article>
        );
      })}
    </section>
  );
}
