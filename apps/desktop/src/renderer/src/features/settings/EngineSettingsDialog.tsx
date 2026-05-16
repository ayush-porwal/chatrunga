import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HexColorPicker } from "react-colorful";
import { Bot, Check, File, FolderOpen, Image, RotateCcw, Save, Trash2, Volume2 } from "lucide-react";
import {
  useCreateEngineMutation,
  useDeleteEngineMutation,
  useEnginesQuery,
  useSettingsQuery,
  useUpdateSettingMutation,
  useUpdateEngineMutation
} from "../../queries/api";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  normalizeBoardSquareHex,
  piecePresentationOptions,
  piecePresentationTailwindClass,
  pieceStyleOptions,
  type AppSettings,
  type BoardTheme,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { CgPieceGlyph, type PreviewPieceRole } from "./piece-style-preview";
import { PieceStyleListbox } from "./PieceStyleListbox";
import { playSound } from "../../sounds/sounds";
import { positionFromFen, START_FEN } from "@chaturanga/shared/chess/position";
import type { DialogFileFilter } from "@chaturanga/shared/ipc/chaturanga-api";
import type { EngineConfig, UpdateEngineInput } from "@chaturanga/shared/types/engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hasDesktopApi } from "@/lib/environment";
import { parseSquare } from "chessops/util";
import type { SquareName } from "chessops/types";
import { localImageSrc } from "@/lib/local-image";
import {
  dialogActions,
  input,
  label,
  modalBackdrop,
  modalPanel,
  muted,
  sectionHeader
} from "@/lib/ui";

const nnWeightsDialogFilters: DialogFileFilter[] = [
  { name: "Network weights / models", extensions: ["pb", "gz", "onnx", "zip"] },
  { name: "All files", extensions: ["*"] }
];

const engineImageDialogFilters: DialogFileFilter[] = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
  { name: "All files", extensions: ["*"] }
];

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

const boardThemeSwatches: Record<BoardTheme, string> = {
  brown: "bg-[conic-gradient(#b58863_25%,#f0d9b5_0_50%,#b58863_0_75%,#f0d9b5_0)] bg-[length:50%_50%]",
  green: "bg-[conic-gradient(#769656_25%,#eeeed2_0_50%,#769656_0_75%,#eeeed2_0)] bg-[length:50%_50%]",
  blue: "bg-[conic-gradient(#5f8fbf_25%,#d7e8f7_0_50%,#5f8fbf_0_75%,#d7e8f7_0)] bg-[length:50%_50%]",
  purple: "bg-[conic-gradient(#8364a2_25%,#e8ddf5_0_50%,#8364a2_0_75%,#e8ddf5_0)] bg-[length:50%_50%]",
  gray: "bg-[conic-gradient(#8f8f8f_25%,#d9d9d9_0_50%,#8f8f8f_0_75%,#d9d9d9_0)] bg-[length:50%_50%]",
  rose: "bg-[conic-gradient(#b17278_25%,#eaded0_0_50%,#b17278_0_75%,#eaded0_0)] bg-[length:50%_50%]",
  newspaper: "bg-[conic-gradient(#9b927d_25%,#f6f0df_0_50%,#9b927d_0_75%,#f6f0df_0)] bg-[length:50%_50%]",
  wood: "bg-[conic-gradient(#9c6235_25%,#e4bf83_0_50%,#9c6235_0_75%,#e4bf83_0)] bg-[length:50%_50%]",
  walnut: "bg-[conic-gradient(#6f452c_25%,#d0a56f_0_50%,#6f452c_0_75%,#d0a56f_0)] bg-[length:50%_50%]",
  slate: "bg-[conic-gradient(#59636f_25%,#c9d1d9_0_50%,#59636f_0_75%,#c9d1d9_0)] bg-[length:50%_50%]"
};

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

function splitEngineArgs(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const result: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed[i] === '"') {
      i += 1;
      const start = i;
      while (i < trimmed.length && trimmed[i] !== '"') i += 1;
      result.push(trimmed.slice(start, i));
      if (trimmed[i] === '"') i += 1;
      continue;
    }
    const start = i;
    while (i < trimmed.length && !/\s/.test(trimmed[i])) i += 1;
    result.push(trimmed.slice(start, i));
  }
  return result;
}

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

export function EngineSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className={modalBackdrop}>
      <div className={modalPanel}>
        <SettingsContent
          headerAction={
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          }
        />
      </div>
    </div>
  );
}

export function EngineSettingsPage() {
  return (
    <section className="h-full min-h-0 overflow-auto px-8 py-6">
      <div className="mx-auto grid w-full max-w-[980px] gap-5">
        <SettingsContent />
      </div>
    </section>
  );
}

function SettingsContent({ headerAction }: { headerAction?: ReactNode }) {
  const engines = useEnginesQuery();
  const settings = useSettingsQuery();
  const updateSetting = useUpdateSettingMutation();
  const createEngine = useCreateEngineMutation();
  const deleteEngine = useDeleteEngineMutation();
  const [name, setName] = useState("Stockfish");
  const [path, setPath] = useState("");
  const [weightsPath, setWeightsPath] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [args, setArgs] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const desktopApiAvailable = hasDesktopApi();
  const [liveBoardColors, setLiveBoardColors] = useState<{
    light?: string;
    dark?: string;
  }>({});
  const appearance = hydratePieceSettings({ ...defaultSettings, ...(settings.data ?? {}) });
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
  const bundledEngines = (engines.data ?? []).filter((engine) => engine.isBundled);
  const customEngines = (engines.data ?? []).filter((engine) => !engine.isBundled);

  function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    updateSetting.mutate({ key, value });
  }

  function applyBoardTheme(theme: BoardTheme) {
    setLiveBoardColors({});
    setSetting("boardTheme", theme);
    setSetting("boardSquareLight", null);
    setSetting("boardSquareDark", null);
  }

  function setBoardSquareColor(key: "boardSquareLight" | "boardSquareDark", value: string | null) {
    const normalized = normalizeBoardSquareHex(value);
    const liveKey = key === "boardSquareLight" ? "light" : "dark";
    setLiveBoardColors((colors) => ({
      ...colors,
      [liveKey]: normalized ?? undefined
    }));
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

  async function pickExecutable() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectExecutable();
    if (selected) setPath(selected);
  }

  async function pickWeightsFileForNewEngine() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectOpenFile(nnWeightsDialogFilters);
    if (selected) setWeightsPath(selected);
  }

  async function pickImageForNewEngine() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectOpenFile(engineImageDialogFilters);
    if (selected) setImagePath(selected);
  }

  async function addEngine() {
    if (!desktopApiAvailable) return;
    const weights = weightsPath.trim();
    const engine = await createEngine.mutateAsync({
      name,
      executablePath: path,
      ...(weights ? { weightsPath: weights } : {}),
      ...(imagePath.trim() ? { imagePath: imagePath.trim() } : {}),
      args: splitEngineArgs(args)
    });
    setPath("");
    setWeightsPath("");
    setImagePath("");
    setArgs("");
    setTestResult(`Saved ${engine.name}`);
  }

  async function testEngine(id?: string) {
    if (!window.chaturanga) return;
    const weights = weightsPath.trim();
    const result = id
      ? await window.chaturanga.engines.test(id)
      : await window.chaturanga.engines.test({
        name,
        executablePath: path,
        ...(weights ? { weightsPath: weights } : {}),
        ...(imagePath.trim() ? { imagePath: imagePath.trim() } : {}),
        args: splitEngineArgs(args)
      });
    setTestResult(
      result.ok ? `OK: ${result.name || "UCI engine"}` : result.error || "Engine failed"
    );
  }

  return (
    <div className="grid gap-2">
      <div className={sectionHeader}>
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold text-[#f4f1ea]">Settings</h2>
          <p className={muted}>Board, sound, and engine configuration.</p>
        </div>
        {headerAction}
      </div>
      {!desktopApiAvailable ? (
        <div className="rounded-lg border border-[#d8ad5a]/25 bg-[#2b2418] px-3 py-2 text-sm leading-5 text-[#f1d7a6]">
          Engine, file, and persisted settings are available in the desktop app. Browser preview uses default settings.
        </div>
      ) : null}

      <section className="grid gap-3 border-b border-[#303030] py-4">
          <div className="grid gap-0.5">
            <h3 className="m-0 text-base font-semibold text-[#f4f1ea]">Board appearance</h3>
            <p className={muted}>Choose a preset, then optionally tune the board with custom controls.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {boardThemes.map((theme) => (
              <button
                key={theme.id}
                className={cn(
                  "grid min-h-[46px] grid-cols-[38px_1fr_16px] items-center gap-2 rounded-[7px] border border-[#303030] bg-[#202020] px-2.5 py-2 text-left text-[#f4f1ea]",
                  !customBoardSelected &&
                    appearance.boardTheme === theme.id &&
                    "border-[#8caf7d] bg-[#263527]"
                )}
                onClick={() => applyBoardTheme(theme.id)}
              >
                <span
                  className={cn(
                    "h-[34px] w-[34px] rounded-md border border-white/20",
                    boardThemeSwatches[theme.id]
                  )}
                />
                <span>{theme.label}</span>
                {!customBoardSelected && appearance.boardTheme === theme.id ? <Check size={15} /> : null}
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            <h4 className="m-0 text-sm font-semibold text-[#f4f1ea]">Pieces</h4>
            <PieceStyleListbox
              id="piece-style-select"
              value={selectedPieceStyle}
              piecePresentation={appearance.piecePresentation}
              describedBy="piece-style-hint"
              onChange={(next) => setSetting("pieceStyle", next)}
            />
            <div className="grid gap-1.5">
              <span id="piece-presentation-label" className={cn("text-sm font-medium text-[#f4f1ea]")}>
                Piece look
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-labelledby="piece-presentation-label"
              >
                {piecePresentationOptions.map((opt) => {
                  const active = appearance.piecePresentation === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        "rounded-[7px] border px-2.5 py-1.5 text-left text-[13px] text-[#f4f1ea] transition-colors",
                        active
                          ? "border-[#8caf7d] bg-[#263527]"
                          : "border-[#303030] bg-[#202020] hover:bg-[#252525]"
                      )}
                      onClick={() => setSetting("piecePresentation", opt.id)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p id="piece-presentation-hint" className={cn(muted, "text-xs leading-5")}>
                {piecePresentationOptions.find((o) => o.id === appearance.piecePresentation)?.description ??
                  ""}
              </p>
            </div>
            <p id="piece-style-hint" className={cn(muted, "text-xs leading-5")}>
              Sets ship as inlined SVG in <code className="text-[11px] text-[#c9cdd4]">generated-piece-themes.css</code>{" "}
              (offline-safe). Piece look applies to every set via lightweight filters on the board.
              {" "}
              {pieceStyleOptions.find((o) => o.id === selectedPieceStyle)?.description ?? ""}
            </p>
          </div>

          <div
            className={cn(
              "grid gap-3 rounded-lg border border-[#303030] bg-[#191b1f] p-3",
              customBoardSelected && "border-[#8caf7d] bg-[#1c241d]"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid gap-0.5">
                <h4 className="m-0 flex items-center gap-2 text-sm font-semibold text-[#f4f1ea]">
                  Custom
                  {customBoardSelected ? <Check size={15} className="text-[#b7d79a]" /> : null}
                </h4>
                <p className={muted}>Use hue for quick exploration, or fine-tune each square exactly.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={resetBoardSquareColors}>
                <RotateCcw size={15} />
                Reset
              </Button>
            </div>
            <div className="grid gap-2">
              <BoardHueMixer onChange={setBoardSquareColors} />
              <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-stretch">
              <div className="grid h-full min-h-[168px] place-items-center lg:place-items-start">
                <CustomBoardPreview
                  light={previewBoardLight}
                  dark={previewBoardDark}
                  pieceStyle={selectedPieceStyle}
                  piecePresentation={appearance.piecePresentation}
                />
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <BoardSquareColorPicker
                    label="Light"
                    color={previewBoardLight}
                    custom={Boolean(liveBoardColors.light ?? appearance.boardSquareLight)}
                    fallback={presetBoardColors.light}
                    onChange={(value) => setBoardSquareColor("boardSquareLight", value)}
                  />
                  <BoardSquareColorPicker
                    label="Dark"
                    color={previewBoardDark}
                    custom={Boolean(liveBoardColors.dark ?? appearance.boardSquareDark)}
                    fallback={presetBoardColors.dark}
                    onChange={(value) => setBoardSquareColor("boardSquareDark", value)}
                  />
                </div>
              </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 rounded-[7px] border border-[#303030] bg-[#202020] px-2.5 py-2">
              <input
                className="w-auto"
                type="checkbox"
                checked={appearance.showCoordinates}
                onChange={(event) => setSetting("showCoordinates", event.target.checked)}
              />
              Coordinates
            </label>
            <label className="flex items-center gap-2 rounded-[7px] border border-[#303030] bg-[#202020] px-2.5 py-2">
              <input
                className="w-auto"
                type="checkbox"
                checked={appearance.showLegalMoves}
                onChange={(event) => setSetting("showLegalMoves", event.target.checked)}
              />
              Legal move dots
            </label>
            <label className="flex items-center gap-2 rounded-[7px] border border-[#303030] bg-[#202020] px-2.5 py-2">
              <input
                className="w-auto"
                type="checkbox"
                checked={appearance.boardAnimation}
                onChange={(event) => setSetting("boardAnimation", event.target.checked)}
              />
              Move animation
            </label>
          </div>
      </section>

      <section className="grid gap-3 border-b border-[#303030] py-4">
          <h3 className="m-0 text-[15px] text-[#dedede]">Sound</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                className="w-auto"
                type="checkbox"
                checked={appearance.soundEnabled}
                onChange={(event) => setSetting("soundEnabled", event.target.checked)}
              />
              Move sounds
            </label>
            <label className="flex min-w-[220px] flex-1 items-center gap-2 text-sm">
              <span>Volume</span>
              <input
                className="w-auto flex-1 border-0 bg-transparent p-0 accent-[#77946f]"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={appearance.soundVolume}
                disabled={!appearance.soundEnabled}
                onChange={(event) => setSetting("soundVolume", Number(event.target.value))}
              />
              <span className={muted}>{Math.round(appearance.soundVolume * 100)}%</span>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => playSound("move", appearance.soundVolume)}
              title="Test move sound"
            >
              <Volume2 size={16} />
              Test
            </Button>
          </div>
      </section>

      <section className="grid gap-3 py-4">
          <h3 className="m-0 text-[15px] text-[#dedede]">Engines</h3>
          {bundledEngines.length ? (
            <div className="grid gap-2">
              <h4 className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
                Bundled engines
              </h4>
              {bundledEngines.map((engine) => (
                <BundledEngineCard engine={engine} key={engine.id} />
              ))}
            </div>
          ) : null}
          <div className="grid gap-1">
            <h4 className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
              Custom engines
            </h4>
            <p className={muted}>Desktop only. Add UCI engines installed on this machine.</p>
          </div>
          <div className="grid gap-2">
            <label className={label}>
              Name
              <input className={input} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className={label}>
              Executable
              <div className="grid grid-cols-[1fr_42px] gap-2">
                <input className={input} value={path} onChange={(event) => setPath(event.target.value)} />
                <Button type="button" variant="outline" size="icon" onClick={pickExecutable} title="Choose file" disabled={!desktopApiAvailable}>
                  <FolderOpen size={16} />
                </Button>
              </div>
            </label>
            <label className={label}>
              Weights file
              <span className={cn(muted, "font-normal")}>
                Optional (Lc0 network file — browse like the executable)
              </span>
              <div className="grid grid-cols-[1fr_42px] gap-2">
                <input
                  className={input}
                  value={weightsPath}
                  onChange={(event) => setWeightsPath(event.target.value)}
                  placeholder="Absolute path to .pb.gz or other network weights"
                />
                <Button type="button" variant="outline" size="icon" onClick={pickWeightsFileForNewEngine} title="Choose weights file" disabled={!desktopApiAvailable}>
                  <File size={16} />
                </Button>
              </div>
            </label>
            <label className={label}>
              Engine image
              <span className={cn(muted, "font-normal")}>Optional logo/avatar shown in engine selectors and games.</span>
              <div className="grid grid-cols-[42px_1fr_42px] gap-2">
                <EngineImagePreview imagePath={imagePath} name={name} />
                <input
                  className={input}
                  value={imagePath}
                  onChange={(event) => setImagePath(event.target.value)}
                  placeholder="Path to PNG, JPG, WebP, GIF, or SVG"
                />
                <Button type="button" variant="outline" size="icon" onClick={pickImageForNewEngine} title="Choose image" disabled={!desktopApiAvailable}>
                  <Image size={16} />
                </Button>
              </div>
            </label>
            <label className={label}>
              Args
              <input
                className={input}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder="Extra flags (weights path above is injected as --weights=…)"
              />
            </label>
          </div>
          <p className={cn(muted, "-mt-2")}>
            The engine starts with working directory set to <strong>the folder containing the executable</strong> (same idea
            as bundling engines next to supporting files). Leela Chess Zero (lc0): set Executable +
            Weights file, or omit Weights and pass <code className="whitespace-nowrap">--weights=…</code> in Args.
            If both Weights field and Args provide <code>--weights</code>, the Weights field wins.
          </p>

          {testResult ? <p className={muted}>{testResult}</p> : null}
          <div className={dialogActions}>
            <Button type="button" variant="outline" onClick={() => testEngine()} disabled={!desktopApiAvailable || !path.trim()}>
              Test
            </Button>
            <Button type="button" variant="secondary" onClick={addEngine} disabled={!desktopApiAvailable || !path.trim()}>
              Add engine
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {customEngines.map((engine) => (
              <SavedEngineEditor
                engine={engine}
                key={`${engine.id}-${engine.updatedAt}`}
                onDelete={() => deleteEngine.mutate(engine.id)}
                onResult={setTestResult}
              />
            ))}
          </div>
      </section>
    </div>
  );
}

function BundledEngineCard({ engine }: { engine: EngineConfig }) {
  return (
    <div className="grid gap-3 rounded-lg border border-[#303030] bg-[#191b1f] p-3 sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:items-center">
      <EngineImagePreview imagePath={engine.imagePath} name={engine.name} />
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="truncate text-[#f4f1ea]">{engine.name}</strong>
          <span className="rounded-full border border-[#8fb66f]/25 bg-[#263527] px-2 py-0.5 text-[11px] text-[#d7e8c5]">
            Bundled
          </span>
          {!engine.isAvailable ? (
            <span className="rounded-full border border-[#d8ad5a]/25 bg-[#2b2418] px-2 py-0.5 text-[11px] text-[#f1d7a6]">
              Binary missing
            </span>
          ) : null}
        </div>
        <span className="truncate text-[13px] text-[#a9adb4]">
          {engine.runtime === "wasm" ? "Browser WASM engine" : engine.executablePath}
        </span>
      </div>
      <span className="justify-self-start rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-[#d8dbe0] sm:justify-self-end">
        {engine.runtime === "wasm" ? "Browser" : "Desktop"}
      </span>
    </div>
  );
}

function SavedEngineEditor({
  engine,
  onDelete,
  onResult
}: {
  engine: EngineConfig;
  onDelete: () => void;
  onResult: (message: string | null) => void;
}) {
  const updateEngine = useUpdateEngineMutation();
  const desktopApiAvailable = hasDesktopApi();
  const [draft, setDraft] = useState({
    name: engine.name,
    executablePath: engine.executablePath,
    weightsPath: engine.weightsPath ?? "",
    imagePath: engine.imagePath ?? "",
    args: engine.args.join(" ")
  });

  function patchDraft(patch: Partial<typeof draft>) {
    setDraft((value) => ({ ...value, ...patch }));
  }

  async function pickExecutable() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectExecutable();
    if (selected) patchDraft({ executablePath: selected });
  }

  async function pickWeightsFile() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectOpenFile(nnWeightsDialogFilters);
    if (selected) patchDraft({ weightsPath: selected });
  }

  async function pickImage() {
    if (!window.chaturanga) return;
    const selected = await window.chaturanga.files.selectOpenFile(engineImageDialogFilters);
    if (selected) patchDraft({ imagePath: selected });
  }

  function save() {
    if (!desktopApiAvailable) return;
    const patch: UpdateEngineInput = {
      name: draft.name.trim() || "UCI Engine",
      executablePath: draft.executablePath.trim(),
      weightsPath: draft.weightsPath.trim() || null,
      imagePath: draft.imagePath.trim() || null,
      args: splitEngineArgs(draft.args)
    };
    updateEngine.mutate({ id: engine.id, patch });
  }

  async function test() {
    if (!window.chaturanga) return;
    const result = await window.chaturanga.engines.test(engine.id);
    onResult(result.ok ? `OK: ${result.name || engine.name}` : result.error || "Engine failed");
  }

  return (
    <div className="grid gap-3 rounded-lg border border-[#303030] bg-[#191b1f] p-3">
      <div className="grid gap-3 sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:items-start">
        <EngineImagePreview imagePath={draft.imagePath} name={draft.name} />
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-[#f4f1ea]">{engine.name}</strong>
            {engine.isDefault ? (
              <span className="rounded-full border border-[#8fb66f]/25 bg-[#263527] px-2 py-0.5 text-[11px] text-[#d7e8c5]">
                Default
              </span>
            ) : null}
          </div>
          <span className="truncate text-[13px] text-[#a9adb4]">{engine.executablePath}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={test} disabled={!desktopApiAvailable}>
            Test
          </Button>
          <Button
            type="button"
            variant={engine.isDefault ? "secondary" : "outline"}
            size="sm"
            disabled={!desktopApiAvailable}
            onClick={() => updateEngine.mutate({ id: engine.id, patch: { isDefault: true } })}
          >
            {engine.isDefault ? "Default" : "Set default"}
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onDelete} title="Delete" disabled={!desktopApiAvailable}>
            <Trash2 size={16} />
          </Button>
        </div>
      </div>

      <label className={label}>
        Name
        <input className={input} value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} />
      </label>

      <label className={label}>
        Executable
        <div className="grid grid-cols-[1fr_42px] gap-2">
          <input className={input} value={draft.executablePath} onChange={(event) => patchDraft({ executablePath: event.target.value })} />
          <Button type="button" variant="outline" size="icon" onClick={pickExecutable} title="Choose executable" disabled={!desktopApiAvailable}>
            <FolderOpen size={16} />
          </Button>
        </div>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>
          Weights file
          <div className="grid grid-cols-[1fr_42px] gap-2">
            <input
              className={input}
              value={draft.weightsPath}
              onChange={(event) => patchDraft({ weightsPath: event.target.value })}
              placeholder="Optional"
            />
            <Button type="button" variant="outline" size="icon" onClick={pickWeightsFile} title="Choose weights file" disabled={!desktopApiAvailable}>
              <File size={16} />
            </Button>
          </div>
        </label>
        <label className={label}>
          Engine image
          <div className="grid grid-cols-[1fr_42px] gap-2">
            <input
              className={input}
              value={draft.imagePath}
              onChange={(event) => patchDraft({ imagePath: event.target.value })}
              placeholder="Optional image path"
            />
            <Button type="button" variant="outline" size="icon" onClick={pickImage} title="Choose image" disabled={!desktopApiAvailable}>
              <Image size={16} />
            </Button>
          </div>
        </label>
      </div>

      <label className={label}>
        Args
        <input
          className={input}
          value={draft.args}
          onChange={(event) => patchDraft({ args: event.target.value })}
          placeholder="Extra flags"
        />
      </label>

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={save} disabled={!desktopApiAvailable || !draft.executablePath.trim() || updateEngine.isPending}>
          <Save size={16} />
          Save changes
        </Button>
      </div>
    </div>
  );
}

function EngineImagePreview({ imagePath, name }: { imagePath: string | null; name: string }) {
  const src = localImageSrc(imagePath);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#263527] text-[#cce6b2]">
      {src ? (
        <img className="h-full w-full object-cover" src={src} alt="" />
      ) : (
        <Bot size={18} />
      )}
      <span className="sr-only">{name} engine image</span>
    </span>
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
    <div className={cn("relative isolate box-border max-w-[220px] w-full min-w-0 shrink-0")}>
      <div
        className={cn(
          /**
           * Flex ranks/files so each square gets real flex size. Pure CSS Grid cells with only
           * Chessground `<piece>` children (absolute-positioned) often collapse → invisible glyphs.
           */
          "cg-wrap orientation-white isolate flex aspect-square w-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-[conic-gradient(var(--preview-dark)_25%,var(--preview-light)_0_50%,var(--preview-dark)_0_75%,var(--preview-light)_0)] bg-[length:25%_25%] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04),0_14px_32px_rgb(0_0_0/0.28)]",
          /**
           * chessground.base.css sets `.cg-wrap piece { width/height: 12.5% }` for full-board geometry.
           * Override so each glyph fills its preview square.
           */
          "[&_piece]:pointer-events-none [&_piece]:!absolute [&_piece]:!inset-0 [&_piece]:!box-border [&_piece]:z-[2] [&_piece]:!size-full [&_piece]:bg-cover",
          cgWrapPieceSetClass(pieceStyle),
          piecePresentationTailwindClass(piecePresentation)
        )}
        style={
          {
            "--preview-light": light,
            "--preview-dark": dark
          } as CSSProperties
        }
        aria-label="Custom board color and piece preview"
      >
        {previewBoardPieces.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="flex min-h-0 min-w-0 flex-1 flex-row"
            aria-hidden="true"
          >
            {row.map((cell, fileIndex) => (
              <span
                key={fileIndex}
                className="relative isolate block min-h-0 min-w-0 flex-1 overflow-hidden bg-transparent"
              >
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
  label,
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

  function commit(next: string) {
    const normalized = normalizeBoardSquareHex(next);
    setDraftState({ source: normalized ?? color, value: normalized ?? next });
    if (normalized) onChange(normalized);
  }

  return (
    <div className="grid gap-2 rounded-[7px] border border-[#303030] bg-[#202020] p-2.5 text-sm text-[#d8d8d8]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            className="size-4 rounded border border-white/20 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.20)]"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          {label}
        </span>
        {custom ? <em className="text-[11px] not-italic text-[#8fb66f]">Custom</em> : null}
      </div>
      <HexColorPicker
        className="!h-28 !w-full [&_.react-colorful__hue]:!h-2.5 [&_.react-colorful__hue]:!rounded-full [&_.react-colorful__last-control]:!rounded-b-md [&_.react-colorful__pointer]:!size-4 [&_.react-colorful__pointer]:!border-2 [&_.react-colorful__pointer]:!border-white [&_.react-colorful__pointer]:!shadow-[0_2px_10px_rgb(0_0_0/0.45)] [&_.react-colorful__saturation]:!rounded-t-md"
        color={color}
        onChange={commit}
      />
      <div className="grid grid-cols-[42px_1fr] gap-2">
        <input
          className="h-10 w-10 cursor-pointer rounded-md border border-white/15 bg-transparent p-0.5"
          type="color"
          value={color}
          onChange={(event) => commit(event.target.value)}
          aria-label={`${label} square color`}
        />
        <input
          className={input}
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
  const colors = boardColorsForHue(hue);

  function updateHue(nextHue: number) {
    setHue(nextHue);
    onChange(boardColorsForHue(nextHue));
  }

  return (
    <div className="rounded-[7px] border border-[#303030] bg-[#202020] p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <strong className="text-sm text-[#f4f1ea]">Hue mixer</strong>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#d8d8d8]">
          <span
            className="size-5 rounded border border-white/15"
            style={{ backgroundColor: colors.light }}
            aria-hidden="true"
          />
          <span
            className="size-5 rounded border border-white/15"
            style={{ backgroundColor: colors.dark }}
            aria-hidden="true"
          />
          <span className="min-w-[4ch] text-right tabular-nums text-[#a9adb4]">{hue}°</span>
        </div>
      </div>
      <input
        className="h-3 w-full cursor-pointer appearance-none rounded-full border border-white/10 bg-[linear-gradient(90deg,#d66_0%,#dd6_16.6%,#6d6_33.3%,#6dd_50%,#66d_66.6%,#d6d_83.3%,#d66_100%)] accent-[#8fb66f] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgb(0_0_0/0.45)]"
        type="range"
        min={0}
        max={359}
        value={hue}
        onChange={(event) => updateHue(Number(event.target.value))}
        aria-label="Board hue"
      />
    </div>
  );
}
