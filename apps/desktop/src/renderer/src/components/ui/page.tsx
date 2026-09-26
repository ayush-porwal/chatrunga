import * as React from "react";
import { cn } from "@/lib/utils";
import { pageContainer, pageDescription, pageShell, sectionDescription, sectionTitle, eyebrow } from "@/lib/ui";

/**
 * Full-page wrapper: scrolls, centers content at max-w-5xl with px-8 py-8.
 * Use for Home, Engine game, Puzzles, Databases, Settings.
 *
 *   <Page>
 *     <PageHeader title="Puzzles" actions={<Button variant="primary">Start</Button>} />
 *     ...sections
 *   </Page>
 */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className={pageShell}>
        <div className={pageContainer}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The one page-header pattern: optional one-line description on the left, optional actions on the
 * right. The page name itself is shown once, in the app titlebar; here it is only the (visually
 * hidden) h1 for the accessibility tree, so pages never repeat a second big title.
 */
function PageHeader({
  title,
  description,
  actions
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className={cn("flex min-h-9 flex-wrap items-center gap-4", !description && !actions && "sr-only")}>
      <h1 className="sr-only">{title}</h1>
      {description ? <p className={cn(pageDescription, "min-w-0 flex-1")}>{description}</p> : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Heading for a card or page section.
 *
 *   <SectionHeader title="Engines" actions={<IconButton .../>} />
 */
function SectionHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-3", className)}>
      <div className="grid min-w-0 gap-0.5">
        <Heading className={sectionTitle}>{title}</Heading>
        {description ? <p className={sectionDescription}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Quiet sentence-case group label ("Bullet", "Saved games"). */
function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn(eyebrow, className)} {...props} />;
}

export { Eyebrow, Page, PageHeader, SectionHeader };
