import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { StudyExplorerProps } from "./explorer/StudyExplorer";

// The Explorer's code loads the first time the tab opens (its own data and Maia).
const StudyExplorer = lazy(() =>
  import("./explorer/StudyExplorer").then((module) => ({ default: module.StudyExplorer }))
);

/**
 * Study's Explorer tab (docs/repertoire-games-and-practice.md §6): the selected position in the
 * user's games, Maia and the health check; its Add stages moves in the New moves card.
 */
export function StudyExplorerTab(props: StudyExplorerProps) {
  return (
    <div className="scroll-area h-full overflow-y-auto p-3">
      <Suspense
        fallback={
          <div className="grid place-items-center py-6" role="status" aria-label="Loading">
            <Loader2 className="size-5 animate-spin text-fg-subtle" />
          </div>
        }
      >
        <StudyExplorer {...props} />
      </Suspense>
    </div>
  );
}
