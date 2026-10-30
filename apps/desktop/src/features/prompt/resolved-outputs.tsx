import { t, useTranslation } from "@/shared/i18n";
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
  useTranslation();

  if (!source) return <p className="muted">{t("prompt.sourceNotRecorded")}</p>;
  return (
    <dl className="resolved-output-metadata">
      <div>
        <dt>{t("prompt.source")}</dt>
        <dd>
          {source.presetInstanceId ? t("prompt.presetOutput") : t("prompt.currentCreation")}
          {source.expanded ? t("prompt.expandedTag") : ""}
          {source.overridden ? t("prompt.instanceOverrideTag") : ""}
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
  useTranslation();

  return (
    <article className="resolved-output-item">
      <header>
        <h4>
          {t("prompt.characterPrefix")}
          {index + 1}
        </h4>
        <span className="tag">
          {character.enabled ? t("prompt.enabled") : t("prompt.disabled")}
        </span>
      </header>
      <dl className="resolved-output-metadata">
        <div>
          <dt>
            {useCoords === true ? t("prompt.customCoordinates") : t("prompt.retainedCoordinates")}
          </dt>
          <dd>
            {t("prompt.xCoordinate")}
            {character.position.x}
            {t("prompt.yCoordinate")}
            {character.position.y}
          </dd>
        </div>
      </dl>
      <h5>{t("prompt.positivePrompt")}</h5>
      <PromptTextEditor
        label={t("prompt.characterPositivePrompt")}
        value={character.positive}
        model={model}
        context="native"
        readOnly
        placeholder={t("prompt.empty")}
      />
      <h5>{t("prompt.negativePrompt")}</h5>
      <PromptTextEditor
        label={t("prompt.characterNegativePrompt")}
        value={character.negative}
        model={model}
        context="native"
        readOnly
        placeholder={t("prompt.empty")}
      />
      <details>
        <summary>{t("prompt.characterContentSources")}</summary>
        <OutputSource source={character} />
        <ContentSources fragments={character.fragments} model={model} />
      </details>
    </article>
  );
}

function ReferenceMaterial({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  if (media.error)
    return (
      <Notice actions={<Button onClick={media.retry}>{t("prompt.retryRead")}</Button>}>
        {media.error}
      </Notice>
    );
  if (!media.asset) return <output>{t("prompt.loadingReferences")}</output>;
  return (
    <div className="resolved-reference-material">
      <p className="muted">{imageName(media.asset)}</p>
      <AssetImage
        asset={media.asset}
        alt={t("prompt.preciseReferenceMaterial")}
        className="resolved-reference-image"
      />
    </div>
  );
}

const referenceTypes: Record<string, string> = {
  get character() {
    return t("prompt.character");
  },
  get style() {
    return t("prompt.style");
  },
  get "character&style"() {
    return t("prompt.characterStyle");
  },
  get costume() {
    return t("prompt.clothing");
  },
  get delta() {
    return t("prompt.difference");
  },
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
  useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <article className="resolved-output-item">
      <header>
        <h4>
          {t("prompt.preciseReferencePrefix")}
          {index + 1}
        </h4>
        <span className="tag">
          {reference.enabled ? t("prompt.enabled") : t("prompt.disabled")}
        </span>
      </header>
      <dl className="resolved-output-metadata">
        <div>
          <dt>{t("prompt.purpose")}</dt>
          <dd>{referenceTypes[reference.referenceType] ?? reference.referenceType}</dd>
        </div>
        <div>
          <dt>{t("prompt.strength")}</dt>
          <dd>{reference.strength}</dd>
        </div>
        <div>
          <dt>{t("prompt.fidelity")}</dt>
          <dd>{reference.fidelity}</dd>
        </div>
        <div>
          <dt>{t("prompt.informationExtracted")}</dt>
          <dd>{reference.informationExtracted}</dd>
        </div>
      </dl>
      <OutputSource source={source} />
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{t("prompt.viewReference")}</summary>
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
  useTranslation();

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
          <h3>
            {t("prompt.charactersHeading")}
            {resolved.characters.length}
          </h3>
          <p className="muted">
            {t("prompt.globalPositioningPrefix")}
            {resolved.settings.useCoords === true
              ? t("prompt.custom")
              : resolved.settings.useCoords === false
                ? t("prompt.automatic")
                : t("prompt.perCharacterPosition")}
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
          <h3>
            {t("prompt.preciseReferencesHeading")}
            {resolved.inputs.references.precise.length}
          </h3>
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
