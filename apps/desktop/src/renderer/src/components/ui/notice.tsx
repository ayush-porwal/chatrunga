import * as React from "react";
import { AlertTriangle, CircleAlert, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const toneClass = {
  info: "border-info/25 bg-info-soft text-fg-secondary [&>svg]:text-info",
  warn: "border-warn/25 bg-warn-soft text-fg-secondary [&>svg]:text-warn",
  danger: "border-danger/25 bg-danger-soft text-fg-secondary [&>svg]:text-danger",
  success: "border-accent/25 bg-accent-soft text-fg-secondary [&>svg]:text-accent"
} as const;

const toneIcon = {
  info: Info,
  warn: AlertTriangle,
  danger: CircleAlert,
  success: CheckCircle2
} as const;

/**
 * Inline banner for errors, warnings and status (web-preview banner, load errors,
 * "download a database first"). One line preferred; `title` optional.
 *
 *   <Notice tone="danger">{error}</Notice>
 */
function Notice({
  tone = "info",
  title,
  icon,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  tone?: keyof typeof toneClass;
  title?: React.ReactNode;
  /** Pass `null` to hide the icon. */
  icon?: React.ReactNode | null;
  action?: React.ReactNode;
}) {
  const Icon = toneIcon[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs leading-5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        toneClass[tone],
        className
      )}
      {...props}
    >
      {icon === undefined ? <Icon /> : icon}
      <div className="grid min-w-0 flex-1 gap-0.5">
        {title ? <strong className="font-semibold text-fg">{title}</strong> : null}
        {children ? <div className="min-w-0 whitespace-pre-wrap break-words">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export { Notice };
