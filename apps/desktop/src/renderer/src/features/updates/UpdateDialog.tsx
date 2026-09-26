import type { UpdateState } from "@chaturanga/shared/types/updates";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatReleaseDate } from "@/lib/app-update";
import { formatSize } from "@/lib/engine-assets";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ReleaseNotes } from "./ReleaseNotes";

/** Settings → Updates → "What's new": the available update's release notes. */
export function UpdateDialog({ state, onClose }: { state: UpdateState; onClose: () => void }) {
  const status = state.status;
  const version = "version" in status ? status.version : null;
  const notes = "notes" in status ? status.notes : "";
  const size = "sizeBytes" in status ? formatSize(status.sizeBytes) : null;
  const date = "releaseDate" in status ? formatReleaseDate(status.releaseDate) : null;
  const details = [date, `You have v${state.currentVersion}`, size].filter(Boolean).join(" · ");

  return (
    <Dialog
      title={version ? `Chaturanga v${version}` : "Release notes"}
      description={details}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <section aria-label="Release notes" className={cn(well, "scroll-area max-h-[min(360px,50vh)] overflow-y-auto px-4 py-3")}>
        <ReleaseNotes notes={notes} />
      </section>
    </Dialog>
  );
}
