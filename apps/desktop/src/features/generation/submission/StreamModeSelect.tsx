import { Field } from "../../../shared/ui";

const modeLabel = (mode: string) =>
  mode === "sse" ? "SSE 预览" : mode === "msgpack" ? "MessagePack 预览" : mode;
import type { CreationInputs } from "../../../bindings/workbench";

type StreamMode = NonNullable<CreationInputs["stream"]>;

export function StreamModeSelect({
  value,
  onChange,
  supported,
  modes,
}: {
  value: CreationInputs["stream"];
  onChange: (value: CreationInputs["stream"]) => void;
  supported: boolean | null;
  modes?: readonly StreamMode[] | null;
}) {
  const options = modes ?? [];
  const invalid =
    value !== null && (supported === false || (modes != null && !options.includes(value)));
  return (
    <div data-setting-field="stream">
      <Field label="执行返回">
        <select
          value={value ?? ""}
          onChange={(event) => {
            const mode = options.find((option) => option === event.target.value);
            onChange(mode ?? null);
          }}
          aria-invalid={invalid}
        >
          <option value="">普通返回</option>
          {options.map((mode) => (
            <option key={mode} value={mode} disabled={supported === false}>
              {modeLabel(mode)}
            </option>
          ))}
          {value && !options.includes(value) && <option value={value}>{modeLabel(value)}</option>}
        </select>
      </Field>
      {invalid && (
        <span className="generation-danger">
          当前模型不支持所选流式方式，请更改模型或选择普通返回。
        </span>
      )}
    </div>
  );
}
