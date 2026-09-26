import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { input, textarea } from "@/lib/ui";

/** Text/number input on tokens. Same look as the `input` class string. */
function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(input, className)} {...props} />;
}

/** Native select with a consistent chevron. */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select className={cn(input, "appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(textarea, className)} {...props} />;
}

export { Input, Select, Textarea };
