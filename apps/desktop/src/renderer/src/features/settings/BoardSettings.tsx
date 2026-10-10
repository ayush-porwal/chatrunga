import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Check, RotateCcw } from "lucide-react";
import {
  boardThemeSquareColors,
  normalizeBoardSquareHex,
  pieceSizesOptions,
  type AppSettings,
  type BoardTheme,
  type PieceSizes
} from "@chaturanga/shared/types/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, SettingRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { cardPadded, fieldLabel, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { boardSquareGradient } from "../board/useBoardAppearance";
import { BoardThumbnail } from "./board-thumbnail";
import { PieceStyleListbox } from "./PieceStyleListbox";
import { useSettingsWriter } from "./use-set-setting";

const boardThemes: Array<{ id: BoardTheme; label: string }> = [
  { id: "brown", label: "Brown" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "gray", label: "Gray" },
  { id: "rose", label: "Rose" },
  { id: "newspaper", label: "Paper" },
  { id: "wood", label: "Wood" },
  { id: "walnut", label: "Walnut" },
  { id: "slate", label: "Slate" },
  { id: "sapphire", label: "Sapphire" }
];

/** Italian Game after 4…Bc5: pieces on both sides, a last move to show the highlight. */
const PREVIEW_FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";
const PREVIEW_LAST_MOVE = "f8c5";

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [r1, g1, b1] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const toHex = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function boardColorsForHue(hue: number): { light: string; dark: string } {
  return {
    light: hslToHex(hue, 0.36, 0.87),
    dark: hslToHex(hue, 0.32, 0.57)
  };
}

export function BoardSection({ appearance }: { appearance: AppSettings }) {
  const { set: setSetting, setMany: setSettings } = useSettingsWriter();
  const [liveBoardColors, setLiveBoardColors] = useState<{ light?: string; dark?: string }>({});
  const [hoverTheme, setHoverTheme] = useState<BoardTheme | null>(null);
  const presetBoardColors = boardThemeSquareColors[appearance.boardTheme];
  const previewBoardLight =
    liveBoardColors.light ?? appearance.boardSquareLight ?? presetBoardColors.light;
  const previewBoardDark =
    liveBoardColors.dark ?? appearance.boardSquareDark ?? presetBoardColors.dark;
  const customBoardSelected = Boolean(
    liveBoardColors.light ||
    liveBoardColors.dark ||
    appearance.boardSquareLight ||
    appearance.boardSquareDark
  );
  const selectedPieceStyle = appearance.pieceStyle;

  // A theme and its square colors are one write (never half-applied); dragging a color or the hue
  // shows at once and is written when it pauses.
  function applyBoardTheme(theme: BoardTheme) {
    setLiveBoardColors({});
    setSettings({ boardTheme: theme, boardSquareLight: null, boardSquareDark: null });
  }

  function setBoardSquareColor(key: "boardSquareLight" | "boardSquareDark", value: string | null) {
    const normalized = normalizeBoardSquareHex(value);
    const liveKey = key === "boardSquareLight" ? "light" : "dark";
    setLiveBoardColors((colors) => ({ ...colors, [liveKey]: normalized ?? undefined }));
    setSetting(key, normalized, { batch: true });
  }

  function setBoardSquareColors(colors: { light: string; dark: string }) {
    setLiveBoardColors(colors);
    setSettings({ boardSquareLight: colors.light, boardSquareDark: colors.dark }, { batch: true });
  }

  function resetBoardSquareColors() {
    setLiveBoardColors({});
    setSettings({ boardSquareLight: null, boardSquareDark: null });
  }

  const hoverColors = hoverTheme ? boardThemeSquareColors[hoverTheme] : null;

  return (
    <section className={cn(cardPadded, "@container grid gap-5")}>
      <SectionHeader
        title="Board"
        description="How the board and pieces look in every game, review and puzzle."
      />

      <div className="grid items-start gap-x-8 gap-y-6 @2xl:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)]">
        <div className="grid min-w-0 gap-5">
          <Field label="Board theme">
            {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- focus goes to the checked radio inside (roving tabindex), not to the group */}
            <div
              role="radiogroup"
              aria-label="Board theme"
              className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-x-2.5 gap-y-3"
              onMouseLeave={() => setHoverTheme(null)}
            >
              {boardThemes.map((theme) => {
                const selected = !customBoardSelected && appearance.boardTheme === theme.id;
                const colors = boardThemeSquareColors[theme.id];
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => applyBoardTheme(theme.id)}
                    onMouseEnter={() => setHoverTheme(theme.id)}
                    onFocus={() => setHoverTheme(theme.id)}
                    onBlur={() => setHoverTheme(null)}
                    className="group grid min-w-0 justify-items-center gap-1.5 rounded-lg outline-none"
                  >
                    <span
                      className={cn(
                        "relative block aspect-square w-full rounded-md bg-[length:50%_50%] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.2)] transition-[box-shadow,transform] duration-standard ease-standard group-hover:-translate-y-px group-focus-visible:ring-2 group-focus-visible:ring-accent/60 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface",
                        selected && "ring-2 ring-accent ring-offset-2 ring-offset-surface"
                      )}
                      style={{ backgroundImage: boardSquareGradient(colors.light, colors.dark) }}
                    >
                      {selected ? (
                        <span className="absolute -right-1.5 -top-1.5 grid size-4 animate-pop-in place-items-center rounded-full bg-accent text-canvas">
                          <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "max-w-full truncate text-2xs transition-colors duration-micro",
                        selected
                          ? "font-medium text-fg"
                          : "text-fg-subtle group-hover:text-fg-secondary"
                      )}
                    >
                      {theme.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <PieceStyleListbox
            id="piece-style-select"
            value={selectedPieceStyle}
            pieceSizes={appearance.pieceSizes}
            onChange={(next) => setSetting("pieceStyle", next)}
          />
          <Field label="Piece sizes">
            <SegmentedControl
              ariaLabel="Piece sizes"
              fullWidth
              size="sm"
              value={appearance.pieceSizes}
              onChange={(next: PieceSizes) => setSetting("pieceSizes", next)}
              options={pieceSizesOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
            />
          </Field>
        </div>

        {/* Live preview: follows the hovered theme, the custom colors and the piece set as they change. */}
        <figure className="grid w-full max-w-60 gap-2 justify-self-center @2xl:sticky @2xl:top-4 @2xl:max-w-none">
          <BoardThumbnail
            fen={PREVIEW_FEN}
            lastMove={PREVIEW_LAST_MOVE}
            light={hoverColors?.light ?? previewBoardLight}
            dark={hoverColors?.dark ?? previewBoardDark}
            pieceStyle={selectedPieceStyle}
            pieceSizes={appearance.pieceSizes}
            label="Preview of the board with your theme and pieces"
          />
        </figure>
      </div>

      <Disclosure
        variant="panel"
        title="Custom colors"
        summary={customBoardSelected ? "In use" : undefined}
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <BoardHueMixer onChange={setBoardSquareColors} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetBoardSquareColors}
              disabled={!customBoardSelected}
            >
              <RotateCcw />
              Reset to theme
            </Button>
          </div>
          <div className="grid content-start gap-3 sm:grid-cols-2">
            <BoardSquareColorPicker
              label="Light squares"
              color={previewBoardLight}
              custom={Boolean(liveBoardColors.light ?? appearance.boardSquareLight)}
              fallback={presetBoardColors.light}
              onChange={(value) => setBoardSquareColor("boardSquareLight", value)}
            />
            <BoardSquareColorPicker
              label="Dark squares"
              color={previewBoardDark}
              custom={Boolean(liveBoardColors.dark ?? appearance.boardSquareDark)}
              fallback={presetBoardColors.dark}
              onChange={(value) => setBoardSquareColor("boardSquareDark", value)}
            />
          </div>
        </div>
      </Disclosure>

      <div className="grid divide-y divide-line-subtle border-t border-line-subtle">
        <SettingRow
          label="Coordinates"
          htmlFor="setting-coordinates"
          description="File letters and rank numbers along the board edge."
          control={
            <Switch
              id="setting-coordinates"
              checked={appearance.showCoordinates}
              onCheckedChange={(v) => setSetting("showCoordinates", v)}
            />
          }
        />
        <SettingRow
          label="Legal move dots"
          htmlFor="setting-legal-moves"
          description="Dots on the squares a picked-up piece can move to."
          control={
            <Switch
              id="setting-legal-moves"
              checked={appearance.showLegalMoves}
              onCheckedChange={(v) => setSetting("showLegalMoves", v)}
            />
          }
        />
        <SettingRow
          label="Move animation"
          htmlFor="setting-animation"
          description="Pieces slide to their new square."
          control={
            <Switch
              id="setting-animation"
              checked={appearance.boardAnimation}
              onCheckedChange={(v) => setSetting("boardAnimation", v)}
            />
          }
        />
      </div>
    </section>
  );
}

function BoardSquareColorPicker({
  color,
  custom,
  fallback,
  label: pickerLabel,
  onChange
}: {
  color: string;
  custom: boolean;
  fallback: string;
  label: string;
  onChange: (value: string | null) => void;
}) {
  const [draftState, setDraftState] = useState({ source: color, value: color });
  const draft = draftState.source === color ? draftState.value : color;
  const inputId = `board-color-${pickerLabel.toLowerCase().replace(/\s+/g, "-")}`;

  function commit(next: string) {
    const normalized = normalizeBoardSquareHex(next);
    setDraftState({ source: normalized ?? color, value: normalized ?? next });
    if (normalized) onChange(normalized);
  }

  return (
    <div className={cn(well, "grid gap-2 p-3")}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className={fieldLabel}>
          {pickerLabel}
        </label>
        {custom ? <Badge tone="accent">Custom</Badge> : null}
      </div>
      <HexColorPicker
        className="!h-28 !w-full [&_.react-colorful__hue]:!h-2.5 [&_.react-colorful__hue]:!rounded-full [&_.react-colorful__last-control]:!rounded-b-md [&_.react-colorful__pointer]:!size-4 [&_.react-colorful__pointer]:!border-2 [&_.react-colorful__pointer]:!border-fg [&_.react-colorful__saturation]:!rounded-t-md"
        color={color}
        onChange={commit}
      />
      <div className="flex gap-2">
        <input
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
          type="color"
          value={color}
          onChange={(event) => commit(event.target.value)}
          aria-label={`${pickerLabel} system color picker`}
        />
        <Input
          id={inputId}
          className="font-mono"
          value={draft}
          onChange={(event) => setDraftState({ source: color, value: event.target.value })}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(draft);
          }}
          placeholder={fallback}
        />
      </div>
    </div>
  );
}

function BoardHueMixer({
  onChange
}: {
  onChange: (colors: { light: string; dark: string }) => void;
}) {
  const [hue, setHue] = useState(350);

  function updateHue(nextHue: number) {
    setHue(nextHue);
    onChange(boardColorsForHue(nextHue));
  }

  return (
    <div className="flex min-w-60 flex-1 items-center gap-3">
      <label htmlFor="board-hue" className={cn(fieldLabel, "shrink-0")}>
        Hue
      </label>
      <input
        id="board-hue"
        className="h-2.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full border border-line bg-[linear-gradient(90deg,#d66_0%,#dd6_16.6%,#6d6_33.3%,#6dd_50%,#66d_66.6%,#d6d_83.3%,#d66_100%)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-fg [&::-webkit-slider-thumb]:bg-transparent"
        type="range"
        min={0}
        max={359}
        value={hue}
        onChange={(event) => updateHue(Number(event.target.value))}
        aria-label="Board hue"
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted">{hue}°</span>
    </div>
  );
}
