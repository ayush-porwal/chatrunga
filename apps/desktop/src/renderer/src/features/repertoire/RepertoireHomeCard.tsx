import { memo } from "react";
import { BookOpen, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sectionTitle } from "@/lib/ui";
import { useRepertoireDueSummaryQuery, useRepertoiresQuery } from "../../queries/repertoire";
import { mostDue, type StudyTarget } from "./repertoire-chapters";

const ACTIVE = {};

/**
 * Home's compact repertoire card (§6.1): decisions due (→ practice the repertoire with the most
 * due) and Continue repertoire study (→ the last chapter and node). Renders nothing when there is
 * neither — Home's game content stays the main thing.
 */
export const RepertoireHomeCard = memo(function RepertoireHomeCard({
  onPractice,
  onStudy,
  onHub
}: {
  onPractice: (repertoireId: string) => void;
  onStudy: (target: StudyTarget) => void;
  onHub: () => void;
}) {
  const due = useRepertoireDueSummaryQuery();
  const dueCount = due.data?.dueCount ?? 0;
  const list = useRepertoiresQuery(ACTIVE);
  const target = dueCount > 0 ? mostDue(list.data ?? []) : null;
  const continueTarget = due.data?.continue ?? null;
  if (!dueCount && !continueTarget) return null;

  return (
    <section
      aria-labelledby="home-repertoire-title"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <GraduationCap className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <h2 id="home-repertoire-title" className={`${sectionTitle} min-w-0 flex-1`}>
        {dueCount
          ? `Repertoire review: ${dueCount} decision${dueCount === 1 ? "" : "s"} due`
          : "Repertoire"}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {continueTarget ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onStudy(continueTarget)}>
            <BookOpen />
            Continue repertoire study
          </Button>
        ) : null}
        {dueCount ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => (target ? onPractice(target.id) : onHub())}
          >
            <GraduationCap />
            Review now
          </Button>
        ) : null}
      </div>
    </section>
  );
});
