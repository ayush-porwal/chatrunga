import { useId, useMemo } from "react";
import { CircleSlash, Flag, Route, StopCircle } from "lucide-react";
import { nodeMetaOf, type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { scopeCause } from "@chaturanga/shared/chess/repertoire-training";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { decisionCountWithMeta } from "./repertoire-model";
import { MARK_TEXT, markEffect, scopeStatus, type MarkKey } from "./training-explanations";

const MARK_ICONS: Record<MarkKey, typeof Flag> = {
  trainingStart: Flag,
  trainingStop: StopCircle,
  disabled: CircleSlash
};

const MARK_KEYS: readonly MarkKey[] = ["trainingStart", "trainingStop", "disabled"];

/**
 * How the selected move takes part in practice ("Practised", or why not), "Rehearse from here",
 * and under "Advanced" the three training marks as switches: each with its current state, what it
 * does to practice, and what switching it would change in this chapter's decisions. The marks are
 * rarely needed, so they stay collapsed unless this move carries one.
 */
export function BoundaryControls({
  chapter,
  lookup,
  color,
  nodeId,
  onSetMeta,
  onRehearseFromHere
}: {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  color: RepertoireColor;
  nodeId: string;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onRehearseFromHere?: () => void;
}) {
  const meta = nodeMetaOf(chapter.nodeMeta, nodeId);
  const status = scopeStatus(scopeCause(chapter, lookup, nodeId), lookup);
  const marks = useMemo(() => {
    const now = decisionCountWithMeta(color, chapter, nodeId, {});
    return {
      now,
      items: MARK_KEYS.map((key) => {
        const on = Boolean(meta[key]);
        const delta = decisionCountWithMeta(color, chapter, nodeId, { [key]: !on }) - now;
        return { key, on, effect: markEffect(on, delta) };
      })
    };
  }, [chapter, color, nodeId, meta]);
  const marked = marks.items.filter((item) => item.on);

  return (
    <section aria-label="Practice at this move" className="grid gap-2">
      <SectionHeader
        as="h3"
        title="Practice at this move"
        description={`${status} · ${marks.now} decision${marks.now === 1 ? "" : "s"} to practise in this chapter`}
        actions={
          onRehearseFromHere ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              title="Play your moves along this branch, with the replies supplied"
              onClick={onRehearseFromHere}
            >
              <Route aria-hidden="true" />
              Rehearse from here
            </Button>
          ) : null
        }
      />
      <Disclosure
        key={nodeId}
        title="Advanced: where practice starts and ends"
        summary={
          marked.length ? marked.map((item) => MARK_TEXT[item.key].label).join(", ") : "No marks"
        }
        defaultOpen={marked.length > 0}
      >
        <ul className="grid gap-3" aria-label="Training marks">
          {marks.items.map((item) => (
            <MarkSwitch
              key={item.key}
              mark={item.key}
              on={item.on}
              effect={item.effect}
              onChange={(on) => onSetMeta(nodeId, { [item.key]: on })}
            />
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

function MarkSwitch({
  mark,
  on,
  effect,
  onChange
}: {
  mark: MarkKey;
  on: boolean;
  effect: string;
  onChange: (on: boolean) => void;
}) {
  const ids = { label: useId(), description: useId(), effect: useId() };
  const Icon = MARK_ICONS[mark];
  const text = MARK_TEXT[mark];
  return (
    <li className="flex items-start gap-2.5">
      <Switch
        className="mt-0.5"
        checked={on}
        onCheckedChange={onChange}
        aria-labelledby={ids.label}
        aria-describedby={`${ids.description} ${ids.effect}`}
      />
      <div className="grid min-w-0 gap-0.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <Icon className="size-3.5 text-fg-subtle" aria-hidden="true" />
          <span id={ids.label}>{text.label}</span>
          {/* The switch announces its own state. */}
          <span className="font-normal text-fg-subtle" aria-hidden="true">
            {on ? "On" : "Off"}
          </span>
        </p>
        <p id={ids.description} className="text-2xs text-fg-muted">
          {text.description}
        </p>
        <p id={ids.effect} className="text-2xs text-fg-subtle">
          {effect}
        </p>
      </div>
    </li>
  );
}
