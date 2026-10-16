import {
  BookMarked,
  ChartSpline,
  Database,
  Download,
  Microscope,
  Puzzle,
  Radio,
  Settings,
  Swords,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One icon per place or command, shared by every way to reach it (sidebar, Play, page actions),
 * so the same destination always looks the same.
 */
export const DESTINATION_ICONS = {
  play: Swords,
  analyze: Microscope,
  review: ChartSpline,
  repertoire: BookMarked,
  puzzles: Puzzle,
  databases: Database,
  broadcasts: Radio,
  importPgn: Upload,
  exportPgn: Download,
  settings: Settings
} as const satisfies Record<string, LucideIcon>;
