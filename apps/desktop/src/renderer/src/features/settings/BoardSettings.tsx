import { useState, type CSSProperties } from "react";
import { HexColorPicker } from "react-colorful";
import { RotateCcw } from "lucide-react";
import { parseSquare } from "chessops/util";
import type { SquareName } from "chessops/types";
import { positionFromFen, START_FEN } from "@chaturanga/shared/chess/position";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  normalizeBoardSquareHex,
  piecePresentationOptions,
  piecePresentationTailwindClass,
  type AppSettings,
  type BoardTheme,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, SettingRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cardPadded, fieldLabel, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { boardSquareGradient } from "../board/useBoardAppearance";
import { CgPieceGlyph, type PreviewPieceRole } from "./piece-style-preview";
import { PieceStyleListbox } from "./PieceStyleListbox";
import { useSetSetting } from "./use-set-setting";

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
  { id: "slate", label: "Slate" }
];

type PreviewCell = { color: "white" | "black"; role: PreviewPieceRole } | null;

/** Rank 8 → 1 (Chessground `orientation-white` preview: Black at top). From {@link START_FEN}. */
const previewBoardPieces: PreviewCell[][] = (() => {
  const board = positionFromFen(START_FEN).board;
  const ranks: PreviewCell[][] = [];
  for (let rank = 8; rank >= 1; rank--) {
    const row: PreviewCell[] = [];
    for (let file = 0; file < 8; file++) {
      const name = (`${"abcdefgh"[file]}${rank}`) as SquareName;
      const square = parseSquare(name);
      const piece = square ? board.get(square) : undefined;
      row.push(
        piece ? { color: piece.color, role: piece.role as PreviewPieceRole } : null
      );
    }
    ranks.push(row);
  }
  return ranks;
})();

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
  const setSetting = useSetSetting();
  const [liveBoardColors, setLiveBoardColors] = useState<{ light?: string; dark?: string }>({});
  const presetBoardColors = boardThemeSquareColors[appearance.boardTheme];
  const previewBoardLight = liveBoardColors.light ?? appearance.boardSquareLight ?? presetBoardColors.light;
  const previewBoardDark = liveBoardColors.dark ?? appearance.boardSquareDark ?? presetBoardColors.dark;
  const customBoardSelected = Boolean(
    liveBoardColors.light || liveBoardColors.dark || appearance.boardSquareLight || appearance.boardSquareDark
  );
  const selectedPieceStyle = appearance.pieceStyle;
  const selectedThemeLabel = customBoardSelected
    ? "Custom colors"
    : boardThemes.find((theme) => theme.id === appearance.boardTheme)?.label;
  const presentationDescription = piecePresentationOptions.find((o) => o.id === appearance.piecePresentation)?.description;

  function applyBoardTheme(theme: BoardTheme) {
    setLiveBoardColors({});
    setSetting("boardTheme", theme);
    setSetting("boardSquareLight", null);
    setSetting("boardSquareDark", null);
  }

  function setBoardSquareColor(key: "boardSquareLight" | "boardSquareDark", value: string | null) {
    const normalized = normalizeBoardSquareHex(value);
    const liveKey = key === "boardSquareLight" ? "light" : "dark";
    setLiveBoardColors((colors) => ({ ...colors, [liveKey]: normalized ?? undefined }));
    setSetting(key, normalized);
  }

  function setBoardSquareColors(colors: { light: string; dark: string }) {
    setLiveBoardColors(colors);
    setSetting("boardSquareLight", colors.light);
    setSetting("boardSquareDark", colors.dark);
  }

  function resetBoardSquareColors() {
    setLiveBoardColors({});
    setSetting("boardSquareLight", null);
    setSetting("boardSquareDark", null);
  }

  return (
    <section className={cn(cardPadded, "grid gap-4")}>
      <SectionHeader title="Board" />

      <Field label="Board theme" hint={selectedThemeLabel}>
        <div role="radiogroup" aria-label="Board theme" className="flex flex-wrap gap-2">
          {boardThemes.map((theme) => {
            const selected = !customBoardSelected && appearance.boardTheme === theme.id;
            return (
              <Tooltip key={theme.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={theme.label}
                    onClick={() => applyBoardTheme(theme.id)}
                    className={cn(
                      "size-9 rounded-lg border border-line bg-[length:50%_50%] outline-none transition-shadow hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/50",
                      selected && "border-accent ring-2 ring-accent/70 ring-offset-2 ring-offset-surface"
                    )}
                    style={{
                      backgroundImage: boardSquareGradient(boardThemeSquareColors[theme.id].light, boardThemeSquareColors[theme.id].dark)
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">{theme.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </Field>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <PieceStyleListbox
          id="piece-style-select"
          value={selectedPieceStyle}
          piecePresentation={appearance.piecePresentation}
          onChange={(next) => setSetting("pieceStyle", next)}
        />
        <Field label="Piece look" hint={presentationDescription}>
          <SegmentedControl
            ariaLabel="Piece look"
            fullWidth
            size="sm"
            className="h-11 [&>button]:h-9"
            value={appearance.piecePresentation}
            onChange={(next: PiecePresentation) => setSetting("piecePresentation", next)}
            options={piecePresentationOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
          />
        </Field>
      </div>

      <Disclosure title="Custom colors" summary={customBoardSelected ? "In use" : undefined}>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <BoardHueMixer onChange={setBoardSquareColors} />
            <Button type="button" variant="outline" size="sm" onClick={resetBoardSquareColors} disabled={!customBoardSelected}>
              <RotateCcw />
              Reset to theme
            </Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <CustomBoardPreview
              light={previewBoardLight}
              dark={previewBoardDark}
              pieceStyle={selectedPieceStyle}
              piecePresentation={appearance.piecePresentation}
            />
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
        </div>
      </Disclosure>

      <div className="grid divide-y divide-line-subtle border-t border-line-subtle">
        <SettingRow
          label="Coordinates"
          htmlFor="setting-coordinates"
          control={<Switch id="setting-coordinates" checked={appearance.showCoordinates} onCheckedChange={(v) => setSetting("showCoordinates", v)} />}
        />
        <SettingRow
          label="Legal move dots"
          htmlFor="setting-legal-moves"
          control={<Switch id="setting-legal-moves" checked={appearance.showLegalMoves} onCheckedChange={(v) => setSetting("showLegalMoves", v)} />}
        />
        <SettingRow
          label="Move animation"
          htmlFor="setting-animation"
          control={<Switch id="setting-animation" checked={appearance.boardAnimation} onCheckedChange={(v) => setSetting("boardAnimation", v)} />}
        />
      </div>
    </section>
  );
}

function CustomBoardPreview({
  light,
  dark,
  pieceStyle,
  piecePresentation
}: {
  light: string;
  dark: string;
  pieceStyle: PieceStyle;
  piecePresentation: PiecePresentation;
}) {
  return (
    <div
      className={cn(
        /**
         * `.cg-wrap` (chessground.base.css) forces `display: block`, so it lives on this outer
         * wrapper — piece-set rules are descendant selectors — and the flex board sits inside.
         * chessground also sets `.cg-wrap piece { width/height: 12.5% }` for full-board geometry;
         * override so each glyph fills its preview square.
         */
        "cg-wrap relative isolate box-border w-full min-w-0 max-w-52 shrink-0",
        "[&_piece]:pointer-events-none [&_piece]:!absolute [&_piece]:!inset-0 [&_piece]:!box-border [&_piece]:z-[2] [&_piece]:!size-full [&_piece]:bg-cover",
        cgWrapPieceSetClass(pieceStyle),
        piecePresentationTailwindClass(piecePresentation)
      )}
    >
      <div
        /**
         * Flex ranks/files so each square gets real flex size. Pure CSS Grid cells with only
         * absolutely-positioned `<piece>` children often collapse → invisible glyphs.
         */
        className="isolate flex aspect-square w-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-[conic-gradient(var(--preview-dark)_25%,var(--preview-light)_0_50%,var(--preview-dark)_0_75%,var(--preview-light)_0)] bg-[length:25%_25%]"
        style={
          {
            "--preview-light": light,
            "--preview-dark": dark
          } as CSSProperties
        }
        role="img"
        aria-label="Board color and piece preview"
      >
        {previewBoardPieces.map((row, rowIndex) => (
          <div key={rowIndex} className="flex min-h-0 min-w-0 flex-1 flex-row" aria-hidden="true">
            {row.map((cell, fileIndex) => (
              <span key={fileIndex} className="relative isolate block min-h-0 min-w-0 flex-1 overflow-hidden bg-transparent">
                {cell ? <CgPieceGlyph color={cell.color} role={cell.role} /> : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
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

function BoardHueMixer({ onChange }: { onChange: (colors: { light: string; dark: string }) => void }) {
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
