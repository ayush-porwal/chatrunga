import { useMemo } from "react";
import { CircleSlash, Flag, Route, StopCircle } from "lucide-react";
import { nodeMetaOf } from "@chaturanga/shared/chess/repertoire-index";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { decisionCountWithMeta, decisionDeltaLabel } from "./repertoire-model";

/** Start / stop / disable toggles for the selected move, with their effect on this chapter. */
export function BoundaryControls({
  chapter,
  color,
  nodeId,
  onSetMeta,
  onRehearseFromHere
}: {
  chapter: RepertoireChapter;
  color: RepertoireColor;
  nodeId: string;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onRehearseFromHere?: () => void;
}) {
  const meta = nodeMetaOf(chapter.nodeMeta, nodeId);
  const toggles = useMemo(() => {
    const now = decisionCountWithMeta(color, chapter, nodeId, {});
    const effect = (patch: Partial<RepertoireNodeMeta>) =>
      decisionDeltaLabel(decisionCountWithMeta(color, chapter, nodeId, patch) - now);
    return {
      now,
      start: effect({ trainingStart: !meta.trainingStart }),
      stop: effect({ trainingStop: !meta.trainingStop }),
      disabled: effect({ disabled: !meta.disabled })
    };
  }, [chapter, color, nodeId, meta.trainingStart, meta.trainingStop, meta.disabled]);

  const items = [
    {
      key: "trainingStart" as const,
      on: Boolean(meta.trainingStart),
      icon: Flag,
      label: "Start training here",
      effect: toggles.start
    },
    {
      key: "trainingStop" as const,
      on: Boolean(meta.trainingStop),
      icon: StopCircle,
      label: "Stop this branch here",
      effect: toggles.stop
    },
    {
      key: "disabled" as const,
      on: Boolean(meta.disabled),
      icon: CircleSlash,
      label: "Disable branch",
      effect: toggles.disabled
    }
  ];

  return (
    <section aria-label="Training boundaries" className="grid gap-2">
      <SectionHeader
        as="h3"
        title="Training boundaries"
        description={`${toggles.now} trainable decision${toggles.now === 1 ? "" : "s"} in this chapter`}
      />
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Button
            key={item.key}
            type="button"
            size="xs"
            variant={item.on ? "primary" : "outline"}
            aria-pressed={item.on}
            title={`${item.on ? "Turn off" : "Turn on"}: ${item.effect} in this chapter`}
            onClick={() => onSetMeta(nodeId, { [item.key]: !item.on })}
          >
            <item.icon aria-hidden="true" />
            {item.label}
            <span className={cn("text-2xs", item.on ? "text-accent-fg/80" : "text-fg-subtle")}>
              ({item.effect})
            </span>
          </Button>
        ))}
        {onRehearseFromHere ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            title="Play your moves along this branch, with the replies supplied"
            onClick={onRehearseFromHere}
          >
            <Route aria-hidden="true" />
            Rehearse from here
          </Button>
        ) : null}
      </div>
    </section>
  );
}
