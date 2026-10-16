import { useUpdateSettingMutation, useSettingsQuery } from "../../queries/api";

/** Adds `name` to the followed players, or takes it out when it is there already. */
export function toggledFollow(followed: readonly string[], name: string): string[] {
  return followed.includes(name) ? followed.filter((item) => item !== name) : [...followed, name];
}

/**
 * Follow / unfollow writes, each built on the one before while it is still being written (a
 * second star clicked before the first reached the settings must keep the first).
 */
export function followWriter(
  write: (followed: string[], settled: () => void) => void
): (current: readonly string[], name: string) => void {
  let pending: string[] | null = null;
  return (current, name) => {
    const next = toggledFollow(pending ?? current, name);
    pending = next;
    write(next, () => {
      if (pending === next) pending = null;
    });
  };
}

/** One writer for every star in the app (they all change the same list). */
let writer: ReturnType<typeof followWriter> | null = null;

/** The broadcast players followed (a setting), and a way to follow or unfollow one. */
export function useFollowedPlayers(): {
  followed: readonly string[];
  toggle: (name: string) => void;
} {
  const settings = useSettingsQuery();
  const { mutate } = useUpdateSettingMutation();
  const followed = settings.data?.followedBroadcastPlayers ?? [];
  return {
    followed,
    toggle: (name) => {
      writer ??= followWriter((value, settled) =>
        mutate({ key: "followedBroadcastPlayers", value }, { onSettled: settled })
      );
      writer(followed, name);
    }
  };
}
