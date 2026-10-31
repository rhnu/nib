import { t, useTranslation } from "@/shared/i18n";
import { useLayoutEffect, useRef, type PointerEvent } from "react";
import type { ModelCapabilities, ResolvedCharacter } from "@/bindings/workbench";
import { Button, HelpMarker, Notice, Select } from "@/shared/ui";
import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";
import { CharacterPositionPolicy } from "@/features/characters";
import { characterKey, normalizePosition, type Position } from "./model";
import "./positioning.css";
import { useSafetyDisplay } from "@/features/media/safety-image";

export function CharacterPositionWorkspace({
  characters,
  capabilities,
  size,
  sourceId,
  selectedKey,
  onSelect,
  onChange,
  useCoords,
  effectiveUseCoords,
  onModeChange,
  onClose,
}: {
  characters: ResolvedCharacter[];
  capabilities: ModelCapabilities | null;
  size: { width: number; height: number };
  sourceId: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onChange: (character: ResolvedCharacter, position: Position) => void;
  useCoords: boolean | null;
  effectiveUseCoords?: boolean | null;
  onModeChange: (value: boolean | null) => void;
  onClose: () => void;
}) {
  useTranslation();

  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    key: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const media = useMediaAsset(sourceId);
  const safety = useSafetyDisplay(sourceId);
  const selected =
    characters.find((item) => characterKey(item) === selectedKey) ??
    characters.find((item) => item.enabled) ??
    characters[0];
  const options = capabilities?.characterPositionOptions;
  const supported =
    capabilities?.characterPositioning === "grid5x5" ||
    capabilities?.characterPositioning === "freeform";
  const grid =
    capabilities?.characterPositioning === "grid5x5" ? (options?.gridCoordinates ?? null) : null;
  const latest = useRef({ characters, options, grid, supported, onChange });
  useLayoutEffect(() => {
    latest.current = { characters, options, grid, supported, onChange };
  });

  const pointFromEvent = (event: { clientX: number; clientY: number }): Position | null => {
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height || !latest.current.options) return null;
    const { min, max } = latest.current.options.range;
    return normalizePosition(
      {
        x: min + ((event.clientX - bounds.left) / bounds.width) * (max - min),
        y: min + ((event.clientY - bounds.top) / bounds.height) * (max - min),
      },
      latest.current.options.range,
      latest.current.grid,
    );
  };

  const commit = (key: string, position: Position | null) => {
    const current = latest.current;
    const character = current.characters.find((item) => characterKey(item) === key);
    if (character?.enabled && position && current.supported) current.onChange(character, position);
  };

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const label = (character: ResolvedCharacter, index: number) =>
    `${index + 1} · ${character.positive.trim().split(/[,\n]/)[0]?.slice(0, 24) || t("positioning.character")}${character.enabled ? "" : t("positioning.disabledSuffix")}`;

  return (
    <section className="character-position-workspace" aria-label={t("positioning.canvas")}>
      <header className="character-position-toolbar">
        <label className="field">
          <span>{t("positioning.character")}</span>
          <Select
            aria-label={t("positioning.positionCharacters")}
            value={selected ? characterKey(selected) : ""}
            onValueChange={onSelect}
            options={characters.map((character, index) => ({
              value: characterKey(character),
              label: label(character, index),
            }))}
          />
        </label>
        <CharacterPositionPolicy
          value={useCoords}
          inherited={effectiveUseCoords}
          onChange={onModeChange}
        />
        <HelpMarker label={t("positioning.canvasControls")}>
          {t("positioning.canvasHelp")}
        </HelpMarker>
        <Button className="quiet" onClick={onClose}>
          {t("positioning.backToImage")}
        </Button>
      </header>
      {!supported && (
        <Notice>
          {capabilities ? t("positioning.positioningUnsupported") : t("positioning.loadingOptions")}
        </Notice>
      )}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>{t("positioning.retryRead")}</Button>}>
          {media.error}
        </Notice>
      )}
      <div className="character-position-stage">
        {/* A two-dimensional canvas needs keyboard focus independently of its marker buttons. */}
        {/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          ref={surface}
          className="character-position-surface"
          role="application"
          aria-label={t("positioning.characterPositions")}
          tabIndex={0}
          onPointerDownCapture={safety.intercept}
          onClickCapture={safety.reveal}
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            width: `min(100%, calc((100vh - 230px) * ${size.width / size.height}))`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || drag.current || !supported || !selected || !selected.enabled)
              return;
            const marker = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-position-marker]",
            );
            const key = marker?.dataset.positionMarker ?? characterKey(selected);
            onSelect(key);
            if (grid && !marker) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              key,
              startX: event.clientX,
              startY: event.clientY,
              moved: !marker,
            };
            if (!marker) commit(key, pointFromEvent(event));
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (current?.pointerId === event.pointerId) {
              current.moved ||=
                Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 2;
              if (current.moved) commit(current.key, pointFromEvent(event));
            }
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId && drag.current.moved)
              commit(drag.current.key, pointFromEvent(event));
            stop(event);
          }}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          onKeyDown={(event) => {
            if (safety.blurred) {
              if (event.key === "Enter" || event.key === " ") safety.reveal(event);
              else safety.intercept(event);
              return;
            }
            if (!selected || !options || !supported || !event.key.startsWith("Arrow")) return;
            event.preventDefault();
            const span = options.range.max - options.range.min;
            const step =
              grid && grid.length > 1 ? grid[1] - grid[0] : span * (event.shiftKey ? 0.05 : 0.01);
            commit(
              characterKey(selected),
              normalizePosition(
                {
                  x:
                    selected.position.x +
                    (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
                  y:
                    selected.position.y +
                    (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
                },
                options.range,
                grid,
              ),
            );
          }}
        >
          {media.asset && (
            <AssetImage
              asset={media.asset}
              safetyDisabled
              alt={t("positioning.backgroundImage")}
              className={`character-position-underlay${safety.blurred ? " image-safety-blurred" : ""}`}
            />
          )}
          {grid && (
            <div
              className="character-position-grid"
              style={{ gridTemplateColumns: `repeat(${grid.length}, 1fr)` }}
            >
              {grid.flatMap((y) =>
                grid.map((x) => (
                  <button
                    type="button"
                    key={`${x}:${y}`}
                    aria-label={t("positioning.positionCoordinates", { value0: x, value1: y })}
                    disabled={!selected?.enabled || !supported}
                    onClick={() => {
                      if (selected) commit(characterKey(selected), { x, y });
                    }}
                  />
                )),
              )}
            </div>
          )}
          {characters.map((character, index) => (
            <button
              type="button"
              key={characterKey(character)}
              className={`character-position-marker ${characterKey(character) === (selected && characterKey(selected)) ? "selected" : ""}`}
              data-position-marker={characterKey(character)}
              aria-label={t("positioning.selectCharacter", { value0: label(character, index) })}
              aria-pressed={characterKey(character) === (selected && characterKey(selected))}
              disabled={!character.enabled || !supported}
              style={{
                left: `${character.position.x * 100}%`,
                top: `${character.position.y * 100}%`,
              }}
              onClick={() => onSelect(characterKey(character))}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </div>
      <footer className="character-position-footer">
        {selected && (
          <output>
            {label(selected, characters.indexOf(selected))}
            {t("positioning.xCoordinate")}
            {selected.position.x.toFixed(3)}
            {t("positioning.yCoordinate")} {selected.position.y.toFixed(3)}
          </output>
        )}
        <span className="muted">
          {size.width} × {size.height}
        </span>
      </footer>
    </section>
  );
}
