import { create } from "zustand";
import type { AddFromGameScope, AddFromGameSource } from "@chaturanga/shared/types/repertoire";
import type { AddEntryPoint } from "../features/repertoire/add-from-game";

/** An "Add to repertoire" dialog to show: the game, the scope hint and where it was asked from. */
export type AddToRepertoireRequest = {
  source: AddFromGameSource;
  initialScope: AddFromGameScope;
  entry: AddEntryPoint;
  /** A repertoire (and a chapter to merge into) chosen beforehand: a repertoire just created. */
  preselect?: { repertoireId: string; chapterId: string | null } | null;
};

/**
 * The open "Add to repertoire" dialog (App renders it over any page) and the repertoire last added
 * to, which the next dialog selects first. Nothing here touches the game store.
 */
type AddToRepertoireStore = {
  request: AddToRepertoireRequest | null;
  lastRepertoireId: string | null;
  open: (request: AddToRepertoireRequest) => void;
  close: () => void;
  remember: (repertoireId: string) => void;
};

export const useAddToRepertoireStore = create<AddToRepertoireStore>((set) => ({
  request: null,
  lastRepertoireId: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
  remember: (repertoireId) => set({ lastRepertoireId: repertoireId })
}));
