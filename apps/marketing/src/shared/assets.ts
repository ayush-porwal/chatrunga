export const KNIGHT_WHITE = "/knight-white.svg";
export const KNIGHT_BLACK = "/knight-black.svg";

// Drop your screenshot at apps/marketing/public/app-screenshot.png — every variation
// references this single path so swapping the image updates the whole site.
export const APP_SCREENSHOT = "/app-screenshot.png";

// Content is intentionally identical across every variation so layouts can be compared
// fairly. Edit copy here in one place.
export const TAGLINE = "A chess studio for your desktop.";
export const SUBTAG =
  "Play, analyse, and review your games with your favourite engines.";
export const ALPHA_LABEL = "Early alpha";
export const CTA_PRIMARY = "Download Chaturanga";
export const CTA_SECONDARY = "See features";

export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" }
] as const;

export const FEATURES = [
  {
    title: "Stockfish, Lc0, and Maia",
    body:
      "Three engines bundled in the app — raw tactics, deep positional play, and human-like sparring. Configurable depth and time controls. No accounts. No servers. No internet."
  },
  {
    title: "Move-by-move review",
    body:
      "Get a classification on every move — brilliant, best, inaccuracy, blunder — with an evaluation graph and engine principal variations."
  },
  {
    title: "Your own library",
    body:
      "Import and export PGN, keep a searchable history of every game you've played or studied, and pick up where you left off."
  },
  {
    title: "Keyboard-first",
    body:
      "Arrow keys walk the move tree, Home and End jump to the start and end of the line, every panel reachable without the mouse. A board you can actually look at for hours."
  }
] as const;
