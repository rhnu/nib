import {
  Decoration,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { PromptDocument } from "@/bindings/prompt";
import { t, formatNumber } from "@/shared/i18n";
import { promptAnalysis, promptContext, promptPending } from "./editor-analysis";
import { promptDiagnostics } from "./editor-diagnostics";

type Weight = PromptDocument["analysis"]["spans"][number]["weight"];

export function weightDescription(weight: Weight): string {
  if (weight.kind === "unknown") return t("prompt.unknownWeight");
  if (weight.kind === "range") {
    return t("prompt.weightRange", {
      value0: formatNumber(weight.min),
      value1: formatNumber(weight.max),
    });
  }
  return t("prompt.exactWeight", {
    value0: formatNumber(weight.value, { maximumFractionDigits: 4 }),
  });
}

export function weightClass(weight: Weight): string {
  if (weight.kind !== "exact") return "prompt-weight-uncertain";
  if (weight.value === 0) return "prompt-weight-zero";
  if (weight.value < 0) return "prompt-weight-negative";
  if (Math.abs(weight.value - 1) < 1e-12) return "prompt-weight-normal";
  if (weight.value > 1) return "prompt-weight-up";
  if (weight.value < 1) return "prompt-weight-down";
  return "prompt-weight-normal";
}

export function semanticDescription(document: PromptDocument | null, position: number): string[] {
  if (!document) return [];
  const messages = promptDiagnostics(document)
    .filter((item) => item.from <= position && position <= item.to)
    .map((item) => item.message);
  const span = document.analysis.spans.find((item) => item.from <= position && position < item.to);
  if (span) messages.push(weightDescription(span.weight));
  const token = document.analysis.tokens.find(
    (item) => item.from <= position && position < item.to,
  );
  if (token?.kind === "mixWeight" && token.value !== null) {
    messages.push(t("prompt.mixingWeight", { value0: formatNumber(token.value) }));
  }
  if (document.comments.some((item) => item.from <= position && position < item.to)) {
    messages.push(t("prompt.sourceComment"));
  }
  return messages;
}

function visibleDecorations(view: EditorView, diagnostics = false): DecorationSet {
  const document = view.state.field(promptAnalysis);
  if (!document) return Decoration.none;
  const ranges: ReturnType<Decoration["range"]>[] = [];

  const mark = (from: number, to: number, className: string, title?: string) => {
    for (const visible of view.visibleRanges) {
      const start = Math.max(from, visible.from);
      const end = Math.min(to, visible.to);
      if (start < end) {
        ranges.push(
          Decoration.mark({ class: className, attributes: title ? { title } : undefined }).range(
            start,
            end,
          ),
        );
      }
    }
  };

  if (diagnostics) {
    for (const diagnostic of promptDiagnostics(document)) {
      mark(
        diagnostic.from,
        diagnostic.to,
        `prompt-diagnostic prompt-diagnostic-${diagnostic.severity}`,
        diagnostic.message,
      );
    }
  } else {
    for (const span of document.analysis.spans) {
      mark(span.from, span.to, weightClass(span.weight));
    }
    for (const token of document.analysis.tokens) {
      if (!["text", "renderedText", "uncertainText"].includes(token.kind)) {
        let className = `prompt-syntax prompt-syntax-${token.kind}`;
        if (token.kind === "numericWeight") {
          className += ` ${weightClass(
            token.value === null ? { kind: "unknown" } : { kind: "exact", value: token.value },
          )}`;
        } else if (token.kind === "strengthen" || token.kind === "weaken") {
          // Closing braces/brackets keep their opening symbol's color, despite reversing its effect.
          className +=
            token.text === "{" || token.text === "}" ? " prompt-weight-up" : " prompt-weight-down";
        }
        mark(token.from, token.to, className);
      }
    }
    for (const comment of document.comments) mark(comment.from, comment.to, "prompt-comment");
  }
  return Decoration.set(ranges, true);
}

/** Decorations are built only for visible ranges; scrolling never triggers parsing. */
export const promptSemantics = ViewPlugin.fromClass(
  class {
    cosmetic: DecorationSet;

    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.cosmetic = visibleDecorations(view);
      this.decorations = this.cosmetic;
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((transaction) => transaction.effects.length)
      ) {
        const current = update.state.field(promptAnalysis);
        if (current) {
          this.cosmetic = visibleDecorations(update.view);
        } else if (
          update.state.field(promptPending) &&
          update.startState.field(promptContext) === update.state.field(promptContext)
        ) {
          // Positions remain cosmetic: diagnostics, completion and hover read only promptAnalysis.
          this.cosmetic = this.cosmetic.map(update.changes);
        } else {
          this.cosmetic = Decoration.none;
        }
        const diagnostics = visibleDecorations(update.view, true);
        const ranges: ReturnType<Decoration["range"]>[] = [];
        diagnostics.between(0, update.state.doc.length, (from, to, decoration) => {
          ranges.push(decoration.range(from, to));
        });
        this.decorations = this.cosmetic.update({ add: ranges, sort: true });
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const promptSemanticTooltip = hoverTooltip(
  (view, position) => {
    const messages = semanticDescription(view.state.field(promptAnalysis), position);
    if (!messages.length) return null;
    return {
      pos: position,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "prompt-semantic-tooltip";
        dom.textContent = messages.join(" · ");
        return { dom };
      },
    };
  },
  {
    hideOn: (transaction) =>
      transaction.startState.field(promptAnalysis) !== transaction.state.field(promptAnalysis) ||
      transaction.startState.field(promptContext) !== transaction.state.field(promptContext),
    hideOnChange: true,
  },
);
