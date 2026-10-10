import { cn } from "@/lib/utils";

/**
 * The title bar of Play's bottom-row cards (Recent games, Start something new, Challenges for you):
 * a 48px row with the title and, when given, a count pill. `id` names the card's region.
 */
export function CardTitleBar({
  id,
  title,
  count,
  className
}: {
  id: string;
  title: string;
  /** Shown as a pill after the title when not null (it is only hidden, never 0, when empty). */
  count?: number | null;
  className?: string;
}) {
  return (
    <div className={cn("flex h-12 shrink-0 items-center gap-2 px-4", className)}>
      <h2 id={id} className="text-sm font-semibold text-fg">
        {title}
      </h2>
      {count ? (
        <span className="inline-grid h-5 min-w-5.5 place-items-center rounded-full bg-control px-1.75 text-[0.71875rem] font-semibold tabular-nums text-fg-muted">
          {count}
        </span>
      ) : null}
    </div>
  );
}
