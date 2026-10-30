import type { ParameterDiagnostic } from "@/bindings/generation";
import { Button } from "@/shared/ui";

export function ParameterDiagnostics({
  diagnostics,
  onLocate,
}: {
  diagnostics: ParameterDiagnostic[];
  onLocate?: (field: string) => void;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <details>
      <summary>SDK 参数调整（{diagnostics.length}）</summary>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.field}-${index}`}>
            {diagnostic.field}：{diagnostic.change}
            {onLocate && (
              <Button className="quiet" onClick={() => onLocate(diagnostic.field)}>
                定位
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
