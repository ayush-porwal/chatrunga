import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { progressCounts, progressPercent, progressPhaseLabel } from "./import-progress";
import type { ImportJob } from "./useImportJob";

/** The input step's actions: open a PGN file, or preview the pasted text. */
export function PgnInputActions({
  job,
  pgn,
  onChooseFile
}: {
  job: ImportJob;
  pgn: string;
  onChooseFile: () => void;
}) {
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={job.busy} onClick={onChooseFile}>
        <Upload />
        Choose file…
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={job.busy || !pgn.trim()}
        onClick={() => job.runPreview(pgn)}
      >
        {job.previewing ? "Reading…" : "Preview"}
      </Button>
    </>
  );
}

/** The pasted PGN and, while it is read, the preview's progress with Cancel. */
export function PgnInputBody({
  job,
  pgn,
  onPgnChange
}: {
  job: ImportJob;
  pgn: string;
  onPgnChange: (pgn: string) => void;
}) {
  const { progress } = job;
  return (
    <>
      <Textarea
        aria-label="PGN text"
        autoFocus
        disabled={job.previewing}
        value={pgn}
        onChange={(event) => onPgnChange(event.target.value)}
        placeholder={'[Event "My 1.e4 repertoire"]\n\n1. e4 e5 2. Nf3 (2. Bc4) *'}
      />
      {job.previewing ? (
        <div className={cn(well, "grid gap-2 p-3")} role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-fg">{progressPhaseLabel(progress)}</span>
            <span className="text-fg-muted tabular-nums">{progressCounts(progress)}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="ml-auto"
              onClick={job.cancelPreview}
            >
              Cancel
            </Button>
          </div>
          <Progress value={progressPercent(progress)} aria-label="Reading the PGN" />
        </div>
      ) : null}
    </>
  );
}
