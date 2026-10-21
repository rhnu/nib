import type { ParameterDiagnostic } from "../../bindings/generation";

export function ParameterDiagnostics({ diagnostics }: { diagnostics: ParameterDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <details>
      <summary>SDK 参数调整（{diagnostics.length}）</summary>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.field}-${index}`}>
            {diagnostic.field}：{diagnostic.change}
          </li>
        ))}
      </ul>
    </details>
  );
}
