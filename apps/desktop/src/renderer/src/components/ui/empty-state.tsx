import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty / zero-data state. One pattern everywhere: optional icon, one title, at most one
 * sentence, at most one action. No dashed boxes, no nested cards.
 *
 *   <EmptyState icon={<Database />} title="No puzzle database"
 *     description="Download one to unlock filters." action={<Button variant="primary">Open databases</Button>} />
 *
 * `compact` renders a single muted line (for small panels like "No moves yet.").
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return <p className={cn("px-1 py-2 text-sm text-fg-muted", className)}>{title}</p>;
  }
  return (
    <div className={cn("grid justify-items-center gap-2 px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-1 text-fg-subtle [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-medium text-fg-secondary">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-5 text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
