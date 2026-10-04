import {
  BarChart3,
  Database,
  Download,
  FileSearch,
  Home,
  Library,
  Puzzle,
  Settings,
  Swords,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One icon per place or command, shared by every way to reach it (sidebar, Home, page actions),
 * so the same destination always looks the same.
 */
export const DESTINATION_ICONS = {
  home: Home,
  play: Swords,
  analyze: FileSearch,
  review: BarChart3,
  repertoire: Library,
  puzzles: Puzzle,
  databases: Database,
  importPgn: Upload,
  exportPgn: Download,
  settings: Settings
} as const satisfies Record<string, LucideIcon>;
