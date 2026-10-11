import {
  BookOpen,
  GraduationCap,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  Play,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/menu";
import type { ResumePracticeTarget, StudyTarget } from "./repertoire-chapters";
import type { HubTargets } from "./useRepertoireHub";

/** The header's Backup menu: back up every repertoire, or restore from a backup file. */
export function BackupMenu({
  onBackUpAll,
  onRestore
}: {
  onBackUpAll: () => void;
  onRestore: () => void;
}) {
  return (
    <OverflowMenu
      label="Backup"
      trigger={{ text: "Backup", icon: <HardDrive /> }}
      items={[
        {
          label: "Back up all repertoires…",
          icon: <HardDriveDownload />,
          onSelect: onBackUpAll
        },
        {
          label: "Restore from backup…",
          icon: <HardDriveUpload />,
          onSelect: onRestore
        }
      ]}
    />
  );
}

/**
 * Where to go from the hub: continue studying, resume the unfinished practice session, create a
 * repertoire and, when anything is due, review it (then the primary action).
 */
export function HubStartActions({
  targets,
  onStudy,
  onResume,
  onReview,
  onCreate
}: {
  targets: HubTargets;
  onStudy: (target: StudyTarget) => void;
  onResume: (target: ResumePracticeTarget) => void;
  onReview: (repertoireId: string) => void;
  onCreate: () => void;
}) {
  const { continueTarget, resume, review } = targets;
  return (
    <>
      {continueTarget ? (
        <Button type="button" variant="ghost" onClick={() => onStudy(continueTarget)}>
          <BookOpen />
          Continue studying
        </Button>
      ) : null}
      {resume ? (
        <Button
          type="button"
          variant="outline"
          title={resume.description}
          onClick={() => onResume(resume)}
        >
          <Play />
          {resume.label}
        </Button>
      ) : null}
      {review ? (
        <>
          <Button type="button" variant="outline" onClick={onCreate}>
            <Plus />
            Create repertoire
          </Button>
          <Button type="button" variant="primary" onClick={() => onReview(review.id)}>
            <GraduationCap />
            Review due ({review.dueCount})
          </Button>
        </>
      ) : (
        <Button type="button" variant="primary" onClick={onCreate}>
          <Plus />
          Create repertoire
        </Button>
      )}
    </>
  );
}
