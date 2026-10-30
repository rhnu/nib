import type { Draft, ResolutionIssue, Resource } from "@/bindings/workbench";

export function tokenFieldLabel(field: string): string {
  if (field === "prompt") return "正面";
  if (field === "negativePrompt") return "负面";
  const character = /^characters\[(\d+)\]\.(prompt|negativePrompt)$/.exec(field);
  if (character)
    return `角色 ${Number(character[1]) + 1} · ${character[2] === "prompt" ? "正面" : "负面"}`;
  return field;
}

/** Resolution issues carry original identities, even if an identity itself contains colons. */
export function resolutionIssueDetails(
  issue: ResolutionIssue,
  draft: Draft,
  resources: Map<string, Resource>,
) {
  const instance = draft.presets.find((item) => item.id === issue.presetInstanceId);
  const resource =
    instance?.binding.kind === "linked" ? resources.get(instance.binding.resourceId) : undefined;
  const output = instance
    ? instance.binding.kind === "expanded"
      ? instance.binding
      : resource?.content.kind === "preset"
        ? resource.content
        : undefined
    : draft;
  const labels = [
    instance
      ? instance.binding.kind === "expanded"
        ? instance.binding.name
        : (resource?.name ?? "缺失的 Preset")
      : "当前创作",
  ];
  let composition = output?.composition;
  let target: string | null = null;
  if (issue.characterId !== null) {
    const index =
      output?.characters.findIndex((character) => character.id === issue.characterId) ?? -1;
    const character = index >= 0 ? output?.characters[index] : undefined;
    composition = character?.composition;
    labels.push(index >= 0 ? `角色 ${index + 1}` : "已移除的角色覆盖");
    target = `character:${JSON.stringify({ id: issue.characterId, presetInstanceId: issue.presetInstanceId, scope: issue.scope, nodeId: issue.nodeId })}`;
  }
  if (!target && issue.nodeId && instance) {
    const precise =
      instance.binding.kind === "linked"
        ? instance.binding.outputOverrides.precise.some(
            (reference) => reference.id === issue.nodeId,
          )
        : instance.binding.references.precise.some((reference) => reference.id === issue.nodeId);
    if (precise) {
      composition = undefined;
      labels.push("精确参考");
      target = `reference:${JSON.stringify({ id: issue.nodeId, presetInstanceId: issue.presetInstanceId })}`;
    }
    const vibe =
      instance.binding.kind === "linked"
        ? instance.binding.outputOverrides.vibes.some((reference) => reference.id === issue.nodeId)
        : instance.binding.references.vibes.some((reference) => reference.id === issue.nodeId);
    if (!target && vibe) {
      composition = undefined;
      labels.push("氛围转移");
      target = `vibe:${JSON.stringify({ id: issue.nodeId, presetInstanceId: issue.presetInstanceId })}`;
    }
  }
  if (issue.scope) labels.push(issue.scope === "positive" ? "基础提示" : "负面提示");
  if (issue.nodeId && composition) {
    const nodes = issue.scope
      ? composition[issue.scope]
      : [...composition.positive, ...composition.negative];
    const index = nodes.findIndex((node) => node.id === issue.nodeId);
    labels.push(index >= 0 ? `第 ${index + 1} 个片段` : "已移除的片段覆盖");
  }
  return { label: labels.join(" · "), target };
}
