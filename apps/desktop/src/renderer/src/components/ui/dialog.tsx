import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { modalBackdrop, modalPanel, modalPanelCompact } from "@/lib/ui";
import { IconButton } from "@/components/ui/icon-button";

/**
 * The one modal pattern: backdrop, raised panel, header (title + optional one-line
 * description + × close), body, optional right-aligned footer.
 * Escape and backdrop click call `onClose` (omit `onClose` for blocking dialogs).
 *
 *   <Dialog title="Import PGN" onClose={close}
 *     footer={<><Button variant="outline">Open file</Button><Button variant="primary">Import</Button></>}>
 *     <Textarea ... />
 *   </Dialog>
 */
function Dialog({
  title,
  description,
  onClose,
  footer,
  size = "md",
  bodyClassName,
  children
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  size?: "sm" | "md";
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(size === "sm" ? modalPanelCompact : modalPanel, "flex flex-col gap-4")}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {onClose ? (
            <IconButton label="Close" icon={<X />} size="icon-sm" className="-mr-1.5 -mt-1" onClick={onClose} tooltip={false} />
          ) : null}
        </header>
        {children ? <div className={cn("min-h-0", bodyClassName)}>{children}</div> : null}
        {footer ? <footer className="flex items-center justify-end gap-2">{footer}</footer> : null}
      </section>
    </div>
  );
}

export { Dialog };
