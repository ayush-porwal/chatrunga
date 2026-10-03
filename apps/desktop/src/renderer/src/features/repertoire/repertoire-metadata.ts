import {
  REPERTOIRE_METADATA_LIMITS,
  type RepertoireDetail,
  type RepertoireSummary,
  type UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { isStaleRevisionError } from "./repertoire-model";

/*
 * The name, description and tags forms: the same rules as the main process (trimmed, tags
 * de-duplicated), but text past a limit is refused with a message instead of being cut.
 */

export type RepertoireMetadata = Pick<RepertoireSummary, "name" | "description" | "tags">;

/** The form's fields as typed: tags as one comma-separated line. */
export type MetadataForm = { name: string; description: string; tags: string };

const LIMITS = REPERTOIRE_METADATA_LIMITS;

/** Tags typed as "sharp, main line, sharp": trimmed, blanks dropped, each kept once. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

export function formatTags(tags: readonly string[]): string {
  return tags.join(", ");
}

export function metadataForm(metadata: RepertoireMetadata): MetadataForm {
  return {
    name: metadata.name,
    description: metadata.description,
    tags: formatTags(metadata.tags)
  };
}

/** The repertoire name's problem, if any (shared with the New repertoire form). */
export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed.length > LIMITS.name) return `Keep the name to ${LIMITS.name} characters.`;
  return null;
}

export type MetadataErrors = Partial<Record<keyof MetadataForm, string>>;

/** What keeps the form from saving, per field; empty when it can be saved. */
export function metadataErrors(form: MetadataForm): MetadataErrors {
  const errors: MetadataErrors = {};
  const name = nameError(form.name);
  if (name) errors.name = name;
  if (form.description.trim().length > LIMITS.description) {
    errors.description = `Keep the description to ${LIMITS.description.toLocaleString("en-US")} characters.`;
  }
  const tags = parseTags(form.tags);
  const long = tags.find((tag) => tag.length > LIMITS.tag);
  if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;
  else if (long) errors.tags = `“${long.slice(0, 20)}…” is longer than ${LIMITS.tag} characters.`;
  return errors;
}

/** The fields the form changes, as stored values; empty when it changes nothing. */
export function metadataPatch(
  original: RepertoireMetadata,
  form: MetadataForm
): UpdateRepertoireMetadataInput["patch"] {
  const patch: UpdateRepertoireMetadataInput["patch"] = {};
  const name = form.name.trim();
  const description = form.description.trim();
  const tags = parseTags(form.tags);
  if (name !== original.name) patch.name = name;
  if (description !== original.description) patch.description = description;
  if (!sameTags(tags, original.tags)) patch.tags = tags;
  return patch;
}

/**
 * True when the stored metadata differs from what the editor opened with: someone (another window,
 * a restore) renamed or retagged it meanwhile, and saving would overwrite that. Other writes to the
 * repertoire (chapter edits, practice) don't count.
 */
export function metadataChanged(opened: RepertoireMetadata, stored: RepertoireMetadata): boolean {
  return (
    opened.name !== stored.name ||
    opened.description !== stored.description ||
    !sameTags(opened.tags, stored.tags)
  );
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export type MetadataSaveOutcome =
  | { kind: "saved"; detail: RepertoireDetail }
  /** The form matches what is stored: nothing to write. */
  | { kind: "unchanged" }
  /** The stored name, description or tags changed since the editor opened: nothing written. */
  | { kind: "conflict"; stored: RepertoireDetail }
  /** The repertoire's open study draft couldn't be saved first: nothing written. */
  | { kind: "draft-unsaved" };

/**
 * Saves the form's changes against the repertoire's current revision. The open study draft of the
 * same repertoire is saved first (so no autosave races the bump); then the stored metadata is read
 * and, when someone changed it since the editor opened, nothing is written (a conflict to reload).
 * A write refused only because another kind of write (a chapter save) landed in between is tried
 * once more against the newer revision; other failures throw.
 */
export async function saveMetadata({
  id,
  opened,
  form,
  flushDraft,
  load,
  write,
  adopt
}: {
  id: string;
  opened: RepertoireMetadata;
  form: MetadataForm;
  /** Saves the open study draft when it is this repertoire's; true when nothing is left unsaved. */
  flushDraft: () => Promise<boolean>;
  /** The stored repertoire, read now. */
  load: () => Promise<RepertoireDetail>;
  write: (input: UpdateRepertoireMetadataInput) => Promise<RepertoireDetail>;
  /** The write moved the repertoire from revision `from` to `to`. */
  adopt: (from: number, to: number) => void;
}): Promise<MetadataSaveOutcome> {
  if (!(await flushDraft())) return { kind: "draft-unsaved" };
  for (let attempt = 0; ; attempt++) {
    const stored = await load();
    if (metadataChanged(opened, stored)) return { kind: "conflict", stored };
    const patch = metadataPatch(stored, form);
    if (!Object.keys(patch).length) return { kind: "unchanged" };
    try {
      const detail = await write({ id, expectedRevision: stored.revision, patch });
      adopt(stored.revision, detail.revision);
      return { kind: "saved", detail };
    } catch (error) {
      if (attempt > 0 || !isStaleRevisionError(ipcErrorMessage(error))) throw error;
    }
  }
}

/** The part of the study workspace store a metadata save updates. */
export type MetadataRevisionTarget = {
  repertoireId: string | null;
  baseRevision: number;
  adoptRevision: (revision: number) => void;
};

/**
 * After a metadata write, the open study draft of the same repertoire adopts the new revision,
 * but only when it was based on the revision the write replaced: a draft already behind is left
 * stale, so its next save is still refused rather than overwriting changes it never saw.
 */
export function adoptMetadataRevision(
  workspace: MetadataRevisionTarget,
  repertoireId: string,
  from: number,
  to: number
): void {
  if (workspace.repertoireId === repertoireId && workspace.baseRevision === from) {
    workspace.adoptRevision(to);
  }
}
