import { Button, Notice, Grid, Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import type {
  InputProvenance,
  PreciseReferenceInput,
  ResolvedCharacter,
  ResolvedDraft,
} from "@/bindings/workbench";

import { AssetImage, useMediaAsset } from "@/features/media";
import { imageName } from "@/features/media/model";
import { PromptTextEditor } from "./prompt-text-editor";
import { ContentSources } from "./resolution-sources";
import { ResolvedVibes } from "@/features/vibes";

/** Base and character prompts share labels, column sizing and read-only behavior. */
export function ResolvedPromptPair({
  positive,
  negative,
  model,
}: {
  positive: string;
  negative: string;
  model: string;
}) {
  useTranslation();

  return (
    <Grid
      gap={0}
      align="stretch"
      className="resolved-prompt-pair grid grid-cols-2 gap-space-3 min-w-0 max-[640px]:grid-cols-1"
    >
      {(["positive", "negative"] as const).map((scope) => {
        const label = t(scope === "positive" ? "prompt.positivePrompt" : "prompt.negativePrompt");
        return (
          <Grid
            gap={0}
            align="stretch"
            columns={1}
            className="resolved-prompt-column grid content-start gap-[5px] min-w-0"
            key={scope}
          >
            <span className="resolved-prompt-label text-muted text-label font-medium">{label}</span>
            <PromptTextEditor
              label={label}
              value={scope === "positive" ? positive : negative}
              model={model}
              context="native"
              readOnly
              placeholder={t("prompt.empty")}
            />
          </Grid>
        );
      })}
    </Grid>
  );
}

function OutputSource({ source }: { source: InputProvenance | ResolvedCharacter | undefined }) {
  useTranslation();

  if (!source) return <p className="muted text-muted">{t("prompt.sourceNotRecorded")}</p>;
  return (
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      as="dl"
      className="resolved-output-metadata [&_>_div]:grid-cols-[80px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid m-0 gap-[5px] text-caption"
    >
      <Grid gap={3} columns={1} className="grid-cols-[80px_minmax(0,1fr)]">
        <dt>{t("prompt.source")}</dt>
        <dd>
          {source.presetInstanceId ? t("prompt.presetOutput") : t("prompt.currentCreation")}
          {source.expanded ? t("prompt.expandedTag") : ""}
          {source.overridden ? t("prompt.instanceOverrideTag") : ""}
        </dd>
      </Grid>
    </Grid>
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
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      as="article"
      className="resolved-output-item [&_header]:flex-wrap [&_header]:items-center [&_:is(h4,_h5,_p)]:m-0 [&_h5]:text-muted [&_h5]:text-caption [&_summary]:text-muted [&_summary]:text-caption [&_details[open]_>_summary]:mb-[10px] [&_header]:flex [&_header]:gap-space-2 grid min-w-0 gap-[10px] border-t border-line-subtle pt-[10px]"
    >
      <Row gap={0} as="header">
        <h4>
          {t("prompt.characterPrefix")}
          {index + 1}
        </h4>
        <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
          {character.enabled ? t("prompt.enabled") : t("prompt.disabled")}
        </span>
        <span className="resolved-character-position ml-auto text-caption muted text-muted">
          {useCoords === true ? t("prompt.customCoordinates") : t("prompt.retainedCoordinates")}
          {" · "}
          {character.position.x}, {character.position.y}
        </span>
      </Row>
      <ResolvedPromptPair
        positive={character.positive}
        negative={character.negative}
        model={model}
      />
      <details>
        <summary>{t("prompt.characterContentSources")}</summary>
        <OutputSource source={character} />
        <ContentSources fragments={character.fragments} model={model} />
      </details>
    </Grid>
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
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      className="resolved-reference-material grid gap-space-3"
    >
      <p className="muted text-muted">{imageName(media.asset)}</p>
      <AssetImage
        asset={media.asset}
        alt={t("prompt.preciseReferenceMaterial")}
        className="resolved-reference-image block w-full max-h-[240px] object-contain"
      />
    </Grid>
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
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      as="article"
      className="resolved-output-item [&_header]:flex-wrap [&_header]:items-center [&_:is(h4,_h5,_p)]:m-0 [&_h5]:text-muted [&_h5]:text-caption [&_summary]:text-muted [&_summary]:text-caption [&_details[open]_>_summary]:mb-[10px] [&_header]:flex [&_header]:gap-space-2 grid min-w-0 gap-[10px] border-t border-line-subtle pt-[10px]"
    >
      <Row gap={0} as="header">
        <h4>
          {t("prompt.preciseReferencePrefix")}
          {index + 1}
        </h4>
        <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
          {reference.enabled ? t("prompt.enabled") : t("prompt.disabled")}
        </span>
      </Row>
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        as="dl"
        className="resolved-output-metadata [&_>_div]:grid-cols-[80px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid m-0 gap-[5px] text-caption"
      >
        <Grid gap={3} columns={1} className="grid-cols-[80px_minmax(0,1fr)]">
          <dt>{t("prompt.purpose")}</dt>
          <dd>{referenceTypes[reference.referenceType] ?? reference.referenceType}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[80px_minmax(0,1fr)]">
          <dt>{t("prompt.strength")}</dt>
          <dd>{reference.strength}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[80px_minmax(0,1fr)]">
          <dt>{t("prompt.fidelity")}</dt>
          <dd>{reference.fidelity}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[80px_minmax(0,1fr)]">
          <dt>{t("prompt.informationExtracted")}</dt>
          <dd>{reference.informationExtracted}</dd>
        </Grid>
      </Grid>
      <OutputSource source={source} />
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{t("prompt.viewReference")}</summary>
        {open && <ReferenceMaterial id={reference.assetId} />}
      </details>
    </Grid>
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
    <Grid
      gap={0}
      align="stretch"
      columns={1}
      className="resolved-outputs [&_>_section]:grid [&_>_section]:min-w-0 [&_>_section]:gap-[10px] [&_>_section_>_p]:m-0 grid min-w-0 gap-[10px] my-[14px] mx-0"
    >
      <ResolvedVibes resolved={resolved} />
      {resolved.characters.length > 0 && (
        <section>
          <h3>
            {t("prompt.charactersHeading")}
            {resolved.characters.length}
          </h3>
          <p className="muted text-muted">
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
    </Grid>
  );
}
