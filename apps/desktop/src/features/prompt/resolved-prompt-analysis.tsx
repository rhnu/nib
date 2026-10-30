import type { ResolvedDraft } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";
import { PromptTextEditor } from "./prompt-text-editor";

/** Display the host's full target analysis without reparsing away its fragment boundaries. */
export function ResolvedPromptAnalysis({
  resolved,
  model,
}: {
  resolved: ResolvedDraft;
  model: string;
}) {
  useTranslation();

  const targets = resolved.promptAnalysis.filter(
    ({ document }) =>
      document.sourceDiagnostics.length > 0 || document.analysis.diagnostics.length > 0,
  );
  if (!targets.length) return null;
  return (
    <section>
      <h3>{t("prompt.combinedSource")}</h3>
      {targets.map((target) => {
        const characterIndex =
          target.characterId === null
            ? -1
            : resolved.characters.findIndex((character) => character.id === target.characterId);
        const fragments =
          target.characterId === null
            ? resolved.fragments
            : resolved.characters[characterIndex].fragments;
        const scope = target.scope === "positive" ? t("prompt.positive") : t("prompt.negative");
        const label =
          target.characterId === null
            ? t("prompt.combinedSourceScope", { value0: scope })
            : t("prompt.combinedCharacterSource", { value0: characterIndex + 1, value1: scope });
        // sources follows the exact Rust compilation order; text and all ranges stay in UTF-16.
        const source = target.sources
          .map(({ fragmentIndex }) => fragments[fragmentIndex].text)
          .join("\n");
        return (
          <div key={`${target.characterId ?? "base"}-${target.scope}`}>
            <h4>{label}</h4>
            <PromptTextEditor
              label={label}
              value={source}
              model={model}
              analysisDocument={target.document}
              readOnly
            />
          </div>
        );
      })}
    </section>
  );
}
