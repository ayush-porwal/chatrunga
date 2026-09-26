import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { modalBackdrop, modalPanel, modalPanelCompact } from "@/lib/ui";
import { IconButton } from "@/components/ui/icon-button";
import { useExitGhost } from "@/components/ui/use-presence";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The one modal pattern: backdrop, raised panel, header (title + optional one-line
 * description + × close), body, optional right-aligned footer.
 * Escape and backdrop click call `onClose` (omit `onClose` for blocking dialogs).
 *
 *   <Dialog title="Import PGN" onClose={close}
 *     footer={<><Button variant="outline">Open file</Button><Button variant="primary">Import</Button></>}>
 *     <Textarea ... />
 *   </Dialog>
 *
 * Motion: the backdrop fades and the panel rises/scales in (emphasis); on unmount a static copy
 * fades/scales out (micro) — parents keep mounting it conditionally, nothing to wire up.
 * Focus: moves into the panel on open (unless a child autofocused), Tab cycles inside it, and focus
 * returns to the previously focused control on close.
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
  const backdropRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);

  useExitGhost(backdropRef);

  React.useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Initial focus + restore on close.
  React.useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || panel?.contains(document.activeElement))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  const trapTab = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={backdropRef}
      data-state="open"
      className={cn(modalBackdrop, "group/dialog data-[state=closed]:animate-fade-out")}
      role="presentation"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          size === "sm" ? modalPanelCompact : modalPanel,
          "flex flex-col gap-4 outline-none group-data-[state=closed]/dialog:animate-dialog-out"
        )}
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
