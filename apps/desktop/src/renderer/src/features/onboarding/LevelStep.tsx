import type { KeyboardEvent, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  normalizePieceStyle,
  pieceStyleOptions,
  type AppSettings,
  type BoardTheme,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import {
  RATINGS_ACCOUNT_LABELS,
  applyRatingToAllModes,
  headlineRating,
  isRatingLocked
} from "@chaturanga/shared/types/ratings";
import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { usePieceSet } from "@/styles/generated-piece-themes";
import { PieceArt, useBoardSquareColors } from "../play/piece-art";
import { CgPieceGlyph } from "../settings/piece-style-preview";
import type { useSetSetting } from "../settings/use-set-setting";
import { LEVEL_PRESETS, nearestLevelPreset } from "./onboarding-state";
import { stepFieldLabel, tileSelected } from "./step-parts";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";

type SetSetting = ReturnType<typeof useSetSetting>;

const themeSwatches: { id: BoardTheme; label: string }[] = [
  { id: "brown", label: "Brown" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "slate", label: "Slate" }
];

/** The piece sets offered here (each shows its own knights); the rest are in Settings → Board. */
const PIECE_SETS: readonly PieceStyle[] = ["cburnett", "merida", "california", "cardinal"];

const pieceSetLabel = (id: PieceStyle) =>
  pieceStyleOptions.find((option) => option.id === id)?.label ?? id;

export function LevelStep({
  settings,
  setSetting,
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & {
  settings: AppSettings;
  setSetting: SetSetting;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <StepHeader {...heading} title="Your level" />
      <RatingField settings={settings} setSetting={setSetting} />
      <SideField settings={settings} setSetting={setSetting} />
      <div className="grid gap-[20px]">
        <BoardField settings={settings} setSetting={setSetting} />
        <PiecesField settings={settings} setSetting={setSetting} />
      </div>
      <StepFooter
        footer={footer}
        back={onBack}
        primary={
          <PrimaryButton onClick={onNext}>
            <ArrowRight />
            Continue
          </PrimaryButton>
        }
      />
    </>
  );
}

type FieldProps = { settings: AppSettings; setSetting: SetSetting };

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="grid gap-[8px]">
      <span className={cn(stepFieldLabel, "flex items-baseline gap-[8px]")}>
        {label}
        {note ? (
          <small className="ml-auto text-[12px] font-normal text-fg-subtle">{note}</small>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * One rating for every mode (Settings → Ratings has them one by one). A mode synced from an
 * account keeps its rating; when the headline (rapid) one is synced, the tiles only show it.
 */
function RatingField({ settings, setSetting }: FieldProps) {
  const headline = settings.playerRatings.rapid;
  const yourRating = headlineRating(settings.playerRatings);
  const selected = nearestLevelPreset(yourRating);
  const exact = LEVEL_PRESETS.some((preset) => preset.rating === yourRating);
  const locked = isRatingLocked(headline);
  const setRating = (rating: number) =>
    setSetting("playerRatings", applyRatingToAllModes(settings.playerRatings, rating));
  return (
    <Field
      label="Rating"
      note={locked ? `From ${RATINGS_ACCOUNT_LABELS[headline.source]}` : undefined}
    >
      <div role="radiogroup" aria-label="Rating" className="grid grid-cols-5 gap-[6px]">
        {LEVEL_PRESETS.map((preset) => {
          const checked = selected.rating === preset.rating;
          return (
            <button
              key={preset.rating}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={locked}
              tabIndex={checked ? 0 : -1}
              onClick={() => setRating(preset.rating)}
              onKeyDown={(event) =>
                radioKeys(
                  event,
                  LEVEL_PRESETS.map((item) => item.rating),
                  preset.rating,
                  setRating
                )
              }
              className={cn(
                "grid min-w-0 gap-[2px] rounded-[10px] border px-[10px] py-[12px] text-left transition-colors duration-[180ms]",
                focusRing,
                checked
                  ? tileSelected
                  : locked
                    ? "border-line bg-surface"
                    : "border-line bg-surface-sunken hover:border-line-strong",
                locked ? "cursor-default" : "cursor-pointer"
              )}
            >
              <b className="font-mono text-[18px] font-bold text-fg tabular-nums">
                {checked && !exact ? yourRating : preset.rating}
              </b>
              <small
                className={cn(
                  "truncate text-[12.5px]",
                  checked ? "text-accent-fg" : "text-fg-subtle"
                )}
              >
                {preset.label}
              </small>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

const SIDES = [
  { id: "white", label: "White", square: "dark" },
  { id: "black", label: "Black", square: "light" }
] as const;

/** The side the user usually plays (what Game review writes its explanations for). */
function SideField({ settings, setSetting }: FieldProps) {
  const squares = useBoardSquareColors();
  const pick = (side: AppSettings["reviewPlayerColor"]) => setSetting("reviewPlayerColor", side);
  return (
    <Field label="You usually play">
      <div role="radiogroup" aria-label="You usually play" className="grid grid-cols-2 gap-[8px]">
        {SIDES.map((side) => {
          const checked = settings.reviewPlayerColor === side.id;
          return (
            <button
              key={side.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => pick(side.id)}
              onKeyDown={(event) =>
                radioKeys(
                  event,
                  SIDES.map((item) => item.id),
                  side.id,
                  pick
                )
              }
              className={cn(
                "flex cursor-pointer items-center gap-[12px] rounded-[12px] border py-[10px] pl-[10px] pr-[14px] text-left transition-[border-color,background-color,translate] duration-[180ms] hover:-translate-y-px",
                focusRing,
                checked ? tileSelected : "border-line bg-surface-sunken hover:border-line-strong"
              )}
            >
              <span
                className="grid size-[44px] shrink-0 place-items-center rounded-[10px] shadow-[0_6px_14px_-8px_#000]"
                style={{ backgroundColor: squares[side.square] }}
              >
                <PieceArt
                  // Remounts on selection, so the king pops in again.
                  key={String(checked)}
                  color={side.id}
                  piece="king"
                  className={cn("size-[36px]", checked && "onb-pop")}
                />
              </span>
              <b className="text-[15px] font-semibold text-fg">{side.label}</b>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function BoardField({ settings, setSetting }: FieldProps) {
  const customTheme = Boolean(settings.boardSquareLight || settings.boardSquareDark);
  const current = customTheme ? null : settings.boardTheme;
  // A theme and its (reset) square colours are one write, never half-applied.
  const pick = (theme: BoardTheme) =>
    setSetting.many({ boardTheme: theme, boardSquareLight: null, boardSquareDark: null });
  return (
    <Field label="Board">
      <div role="radiogroup" aria-label="Board" className="flex gap-[8px]">
        {themeSwatches.map((theme) => {
          const colors = boardThemeSquareColors[theme.id];
          return (
            <SwatchButton
              key={theme.id}
              label={theme.label}
              checked={current === theme.id}
              tabbable={rovingTabStop(
                themeSwatches.map((item) => item.id),
                current,
                theme.id
              )}
              onPick={() => pick(theme.id)}
              onKeyDown={(event) =>
                radioKeys(
                  event,
                  themeSwatches.map((item) => item.id),
                  theme.id,
                  pick
                )
              }
              className="size-[48px]"
              style={{
                background: `repeating-conic-gradient(${colors.dark} 0 25%, ${colors.light} 0 50%) 0 0 / 20px 20px`
              }}
            />
          );
        })}
      </div>
    </Field>
  );
}

function PiecesField({ settings, setSetting }: FieldProps) {
  const current = normalizePieceStyle(settings.pieceStyle);
  const squares = useBoardSquareColors();
  const pick = (style: PieceStyle) => setSetting("pieceStyle", style);
  return (
    <Field label="Pieces">
      <div role="radiogroup" aria-label="Pieces" className="flex flex-wrap gap-[8px]">
        {PIECE_SETS.map((style) => (
          <SwatchButton
            key={style}
            label={pieceSetLabel(style)}
            checked={current === style}
            tabbable={rovingTabStop(PIECE_SETS, current, style)}
            onPick={() => pick(style)}
            onKeyDown={(event) => radioKeys(event, PIECE_SETS, style, pick)}
            className="flex h-[48px] w-[64px] items-center justify-center"
            style={{ backgroundColor: squares.light }}
          >
            <SetKnights style={style} />
          </SwatchButton>
        ))}
      </div>
    </Field>
  );
}

const KNIGHTS = [
  { color: "white", role: "knight" },
  { color: "black", role: "knight" }
] as const;

/** A set's own white and black knights, side by side. */
function SetKnights({ style }: { style: PieceStyle }) {
  usePieceSet(style);
  return (
    <span
      aria-hidden
      className={cn("cg-wrap", cgWrapPieceSetClass(style))}
      // Unlayered `.cg-wrap` rules (display:block, inline-size containment) beat utilities.
      style={{ display: "flex", containerType: "normal" }}
    >
      {KNIGHTS.map(({ color, role }) => (
        <span key={color} className="relative inline-block size-[30px] overflow-hidden">
          <CgPieceGlyph color={color} role={role} />
        </span>
      ))}
    </span>
  );
}

/** A square radio tile (board colours, piece sets): an accent ring when chosen. */
function SwatchButton({
  label,
  checked,
  tabbable,
  onPick,
  onKeyDown,
  className,
  style,
  children
}: {
  label: string;
  checked: boolean;
  tabbable: boolean;
  onPick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  className: string;
  style: React.CSSProperties;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className={cn(
        "relative cursor-pointer rounded-[9px] outline-none transition-shadow duration-[180ms]",
        // The chosen tile wears the accent ring: keyboard focus is a light one.
        checked
          ? "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-accent)]"
          : "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.3)]",
        "focus-visible:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-fg)]",
        className
      )}
      style={style}
    >
      {children}
    </button>
  );
}

/** The radio that takes Tab: the chosen one, else the first (when none of them is chosen). */
function rovingTabStop<T>(values: readonly T[], current: T | null, id: T): boolean {
  return current !== null && values.includes(current) ? current === id : values.at(0) === id;
}

/** Arrow keys move the selection inside a custom radiogroup (and focus follows it). */
function radioKeys<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void
) {
  const delta =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (!delta) return;
  event.preventDefault();
  const index = (values.indexOf(current) + delta + values.length) % values.length;
  select(values[index]);
  const buttons =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons?.[index]?.focus();
}
