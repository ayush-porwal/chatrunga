import { create } from "zustand";

/**
 * The chapter Study's engine panel is open for (null: closed). The titlebar's Analyze toggles it
 * and the study page shows it; another chapter, or leaving Study, closes it, which stops its
 * search.
 */
type StudyEngineStore = {
  chapterId: string | null;
  toggle: (chapterId: string) => void;
  close: () => void;
};

export const useStudyEngineStore = create<StudyEngineStore>((set) => ({
  chapterId: null,
  toggle: (chapterId) =>
    set((state) => ({ chapterId: state.chapterId === chapterId ? null : chapterId })),
  close: () => set({ chapterId: null })
}));
