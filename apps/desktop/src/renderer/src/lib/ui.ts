import type { MoveClassification } from "@chaturanga/shared/types/engine";

/*
 * Shared class strings built on the design tokens in styles/app.css.
 * Rules: flat surfaces (no gradients, no shadows on in-page panels), one radius per role
 * (controls rounded-lg, cards/modals rounded-xl, chips rounded-full), tokens only — no hex.
 * Prefer the React components in components/ui/* where one exists; use these strings for
 * one-off layouts. See the UI style guide for the full contract.
 */

/* ------------------------------------------------------------------ motion */

/**
 * Motion tokens (styles/app.css `@theme static`). One small vocabulary for every animation:
 *
 *   duration   micro 120ms     hover/press colour, exits, tooltips
 *              standard 180ms  popovers, menus, toggles, sliding indicators, disclosures
 *              emphasis 240ms  dialogs, the sidebar, view changes
 *   easing     ease-enter      things arriving (out-quint: fast start, long settle)
 *              ease-exit       things leaving (in-cubic: quick, accelerating away)
 *              ease-standard   state changes in place (colours, widths, the sidebar)
 *              ease-spring     indicators that travel (segmented pill, switch thumb) — small overshoot
 *   keyframes  animate-fade-in/out, animate-pop-in/out (popovers; set `origin-*` to the trigger side),
 *              animate-rise-in (content appearing in place), animate-dialog-in/out, animate-indeterminate
 *
 * Rules: animate only `transform` and `opacity` (the sidebar grid column is the one deliberate
 * exception); exits are shorter than enters; no `will-change` unless measured. Reduced motion:
 * transitions are instant and the keyframes collapse to plain fades (app.css), so components need no
 * extra handling beyond not depending on `transitionend` — use a timeout of `motion.ms.*` instead.
 */
export const motion = {
  /** Durations in ms, for timers that wait for an exit animation (never for styling). */
  ms: { micro: 120, standard: 180, emphasis: 240 },
  /** Colour/background/border/shadow state changes (hover, selected, focus ring). */
  colors: "transition-[color,background-color,border-color,box-shadow,opacity] duration-micro ease-standard",
  /** Pressable surface: colour changes plus a 0.98 press (Button, chips, rows). */
  press:
    "transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-micro ease-standard active:scale-[0.98] motion-reduce:active:scale-100",
  /** Popover / menu surface enter and exit (pair with `data-state="open|closed"` and an `origin-*`). */
  popover: "animate-pop-in data-[state=closed]:animate-pop-out",
  /** Something appearing in place (a notice, an error, a status line). */
  appear: "animate-rise-in"
} as const;

/** The crisp keyboard focus ring for every control (2px accent, no blur). */
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

/**
 * Frosted backdrop for floating surfaces on the glass window: the STABLE layer that carries the
 * `backdrop-filter` (see `.ui-frost` in app.css). Render as the first child of the popover's positioned
 * box, then put the animated, tinted surface after it. A no-op off glass.
 */
export const frost = "ui-frost";

/** Floating surface fill that lets the frost show through on glass (still ~85% opaque for contrast). */
export const floatingSurface = "bg-surface-raised glass:bg-surface-raised/85";

/* ------------------------------------------------------------------ surfaces */

/** A card / panel on the page. Pair with a padding utility (`p-4`) or use `cardPadded`. */
export const card = "w-full min-w-0 rounded-xl border border-line bg-surface";

/** Card with the standard padding. */
export const cardPadded = `${card} p-4`;

/** Recessed area *inside* a card (code, scroll lists). Not a second card — no heading, no shadow. */
export const well = "rounded-lg border border-line-subtle bg-surface-sunken";

/** Thin horizontal rule between sections of the same card/page. */
export const divider = "h-px w-full bg-line-subtle";

/* ------------------------------------------------------------------ app frame */

/**
 * The app frame: titlebar + sidebar are window chrome (`bg-chrome`); every view (pages and board
 * workspaces) sits in ONE inset content panel below the titlebar, right of the sidebar.
 * Glass (macOS vibrancy): the chrome becomes a translucent tint over the blurred desktop; mark the
 * chrome regions with `data-chrome` so their fills/lines switch to the glass tokens (app.css).
 */
export const appFrame = "grid h-screen overflow-hidden bg-chrome text-fg glass:bg-chrome-glass";

/**
 * The inset content panel: darker canvas, hairline border, rounded corners, a small gap to the window
 * edge. Always opaque — on glass it floats on the chrome with a light inner hairline and a soft shadow.
 */
export const contentPanel =
  "relative mb-2 mr-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-canvas glass:border-white/[0.08] glass:shadow-panel-glass";

/**
 * Every icon-only toolbar button in the titlebar (sidebar toggle, Flip board): one 28px hit area,
 * rounded-md, 18px glyph at stroke 1.75 — the macOS toolbar proportions. Muted → fg on hover
 * comes from the ghost button variant. Pass as `className` to <IconButton>.
 */
export const titlebarIconButton =
  "size-7 rounded-md [-webkit-app-region:no-drag] [&_svg]:size-[18px] [&_svg]:stroke-[1.75]";

/* ------------------------------------------------------------------ page layout */

/** Outer scroll container for a full page (fills the content area). */
export const pageShell = "scroll-area scroll-fade h-full min-h-0 w-full overflow-y-auto [scrollbar-gutter:stable]";

/**
 * Centered content column: one max width + one gutter for every page, both fluid (the
 * `--page-*` variables in app.css): 64rem of content on laptop windows up to 88rem on wide
 * monitors, 24–56px gutters. The width includes the gutters, so every page shares the same edges.
 */
export const pageContainer =
  "mx-auto grid w-full max-w-[calc(var(--page-content)+2*var(--page-gutter))] content-start gap-6 px-(--page-gutter) py-(--page-gutter-y)";

export const pageDescription = "max-w-2xl text-sm leading-6 text-fg-muted";

/* ------------------------------------------------------------------ typography */

/** Heading of a card or page section. */
export const sectionTitle = "text-sm font-semibold text-fg";
/** One-line description under a section title (only when it adds information). */
export const sectionDescription = "text-xs leading-5 text-fg-muted";
/** Quiet sentence-case label for groups / stat labels (no caps, normal tracking). */
export const eyebrow = "text-xs font-normal text-fg-muted";

/* ------------------------------------------------------------------ forms */

export const input =
  "h-9 w-full min-w-0 rounded-lg border border-line bg-surface-sunken px-3 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50";

export const textarea =
  "min-h-[260px] w-full resize-y rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15";

export const fieldLabel = "text-xs font-medium text-fg-secondary";
export const fieldHint = "text-2xs leading-4 text-fg-subtle";

/* ------------------------------------------------------------------ modals */

export const modalBackdrop = "fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 animate-fade-in";

export const modalPanel =
  "scroll-area max-h-[calc(100vh-48px)] w-[min(45rem,calc(100vw-40px))] overflow-auto rounded-xl border border-line bg-surface-raised p-5 shadow-overlay animate-dialog-in";

export const modalPanelCompact =
  "scroll-area max-h-[calc(100vh-48px)] w-[min(28.75rem,calc(100vw-40px))] overflow-auto rounded-xl border border-line bg-surface-raised p-5 shadow-overlay animate-dialog-in";

/**
 * Floating popover / dropdown list surface: enters with a pop from its origin (add `origin-top-left`
 * etc. for the trigger side). On glass, render `<span className={cn(frost, "rounded-lg")} />` as a
 * sibling under it for the frosted backdrop (see OverflowMenu).
 */
export const popover =
  "z-50 rounded-lg border border-line bg-surface-raised p-1 shadow-popover glass:bg-surface-raised/85 animate-pop-in data-[state=closed]:animate-pop-out";

/* ------------------------------------------------------------------ rows, tiles, chips */

/** A row in a list (saved games, engines, assets). Static. */
export const listRow =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-fg-secondary";

/** Clickable list row. Add `listRowSelected` when active. */
export const listRowInteractive = `${listRow} transition-[color,background-color,border-color,box-shadow,scale] duration-micro ease-standard hover:border-line-strong hover:bg-control active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:active:scale-100`;

export const listRowSelected = "border-accent/50 bg-accent-soft text-fg";

/* ------------------------------------------------------------------ review classification */

/**
 * One colour language for move quality, shared by the move tree, review tape,
 * commentary badge and summary counts.
 * - `badge`: tinted pill (bg + text) — use for "?!", "Blunder", etc.
 * - `text`: foreground colour only — use for counts and inline labels.
 * - `dot`: solid background — use for small markers.
 */
export const qualityTone: Record<MoveClassification, { badge: string; text: string; dot: string }> = {
  best: { badge: "bg-accent/15 text-accent-fg", text: "text-accent", dot: "bg-accent" },
  excellent: { badge: "bg-accent/15 text-accent-fg", text: "text-accent", dot: "bg-accent" },
  good: { badge: "bg-info/15 text-info", text: "text-info", dot: "bg-info" },
  inaccuracy: { badge: "bg-warn/15 text-warn", text: "text-warn", dot: "bg-warn" },
  mistake: { badge: "bg-caution/15 text-caution", text: "text-caution", dot: "bg-caution" },
  blunder: { badge: "bg-danger/15 text-danger", text: "text-danger", dot: "bg-danger" },
  missed_tactic: { badge: "bg-danger/15 text-danger", text: "text-danger", dot: "bg-danger" },
  human_error: { badge: "bg-danger/15 text-danger", text: "text-danger", dot: "bg-danger" }
};
