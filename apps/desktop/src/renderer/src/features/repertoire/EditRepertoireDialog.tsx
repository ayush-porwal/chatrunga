import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REPERTOIRE_METADATA_LIMITS,
  type RepertoireDetail,
  type RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  repertoireKeys,
  useRepertoireQuery,
  useUpdateRepertoireMetadataMutation
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { mustFlushDraftBeforeImport } from "./import-progress";
import {
  adoptMetadataRevision,
  metadataChanged,
  metadataErrors,
  metadataForm,
  saveMetadata,
  type MetadataForm,
  type RepertoireMetadata
} from "./repertoire-metadata";
import { flushChapterDraft } from "./useChapterAutosave";

const LIMITS = REPERTOIRE_METADATA_LIMITS;

/**
 * Edit repertoire: name, description and tags (searchable on the hub). The editor remembers what
 * it opened with; when the stored details change meanwhile (another window, a restore) it says so
 * and offers Reload instead of overwriting them. A save first saves the repertoire's open study
 * draft, and that draft adopts the new revision so its next autosave isn't refused as stale.
 */
export function EditRepertoireDialog({
  repertoire,
  onClose,
  onSaved
}: {
  repertoire: RepertoireSummary;
  onClose: () => void;
  onSaved: (detail: RepertoireDetail) => void;
}) {
  const ids = { name: useId(), description: useId(), tags: useId() };
  const queryClient = useQueryClient();
  const update = useUpdateRepertoireMetadataMutation();
  const live = useRepertoireQuery(repertoire.id);
  const [opened, setOpened] = useState<RepertoireMetadata>(() => ({
    name: repertoire.name,
    description: repertoire.description,
    tags: repertoire.tags
  }));
  const [form, setForm] = useState<MetadataForm>(() => metadataForm(repertoire));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The stored details, when they differ from what the editor opened with. */
  const [conflict, setConflict] = useState<RepertoireMetadata | null>(null);
  // The repertoire's details as stored now (refreshed on every change event) also reveal a
  // conflict before Save is pressed.
  const changedElsewhere =
    conflict ?? (live.data && metadataChanged(opened, live.data) ? live.data : null);
  const errors = metadataErrors(form);
  const canSave = !Object.keys(errors).length && !saving && !changedElsewhere;

  const set = (patch: Partial<MetadataForm>) => setForm((current) => ({ ...current, ...patch }));

  /** Starts over from the stored details (the typed changes are dropped). */
  const reload = (stored: RepertoireMetadata) => {
    const next = { name: stored.name, description: stored.description, tags: stored.tags };
    setOpened(next);
    setForm(metadataForm(next));
    setConflict(null);
    setError(null);
  };

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const api = window.chaturanga?.repertoires;
    try {
      if (!api) throw new Error("Repertoires need the desktop app.");
      const outcome = await saveMetadata({
        id: repertoire.id,
        opened,
        form,
        flushDraft: () =>
          mustFlushDraftBeforeImport(useRepertoireWorkspaceStore.getState(), repertoire.id)
            ? flushChapterDraft(queryClient)
            : Promise.resolve(true),
        load: () =>
          queryClient.fetchQuery({
            queryKey: repertoireKeys.detail(repertoire.id),
            queryFn: () => api.get(repertoire.id),
            staleTime: 0
          }),
        write: (input) => update.mutateAsync(input),
        adopt: (from, to) =>
          adoptMetadataRevision(useRepertoireWorkspaceStore.getState(), repertoire.id, from, to)
      });
      if (outcome.kind === "saved") onSaved(outcome.detail);
      else if (outcome.kind === "unchanged") onClose();
      else if (outcome.kind === "conflict") setConflict(outcome.stored);
      else setError("The open chapter couldn't be saved; retry its save, then save these details.");
    } catch (cause) {
      setError(ipcErrorMessage(cause) || "Couldn't save the details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      size="sm"
      title="Edit repertoire"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
      bodyClassName="grid gap-4"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name" htmlFor={ids.name}>
          <Input
            id={ids.name}
            autoFocus
            value={form.name}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={errors.name ? `${ids.name}-error` : undefined}
            onChange={(event) => set({ name: event.target.value })}
          />
          {errors.name ? (
            <p id={`${ids.name}-error`} className="text-2xs text-danger">
              {errors.name}
            </p>
          ) : null}
        </Field>
        <Field label="Description" hint="Optional" htmlFor={ids.description}>
          <Textarea
            id={ids.description}
            className="min-h-20"
            value={form.description}
            aria-invalid={Boolean(errors.description) || undefined}
            aria-describedby={errors.description ? `${ids.description}-error` : undefined}
            onChange={(event) => set({ description: event.target.value })}
          />
          {errors.description ? (
            <p id={`${ids.description}-error`} className="text-2xs text-danger">
              {errors.description}
            </p>
          ) : null}
        </Field>
        <Field label="Tags" hint={`Comma-separated, up to ${LIMITS.tags}`} htmlFor={ids.tags}>
          <Input
            id={ids.tags}
            placeholder="sicilian, sharp, main lines"
            value={form.tags}
            aria-invalid={Boolean(errors.tags) || undefined}
            aria-describedby={errors.tags ? `${ids.tags}-error` : undefined}
            onChange={(event) => set({ tags: event.target.value })}
          />
          {errors.tags ? (
            <p id={`${ids.tags}-error`} className="text-2xs text-danger">
              {errors.tags}
            </p>
          ) : null}
        </Field>
        <button type="submit" hidden />
      </form>
      {changedElsewhere ? (
        <Notice
          tone="warn"
          title="Changed since you opened this"
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => reload(changedElsewhere)}
            >
              Reload
            </Button>
          }
        >
          This repertoire's details were changed elsewhere (now “{changedElsewhere.name}”). Reload
          to edit the current details; your changes here are discarded.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
