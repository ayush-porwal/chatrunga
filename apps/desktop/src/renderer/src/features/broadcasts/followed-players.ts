import { useUpdateSettingMutation, useSettingsQuery } from "../../queries/api";

/** Adds `name` to the followed players, or takes it out when it is there already. */
export function toggledFollow(followed: readonly string[], name: string): string[] {
  return followed.includes(name) ? followed.filter((item) => item !== name) : [...followed, name];
}

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
    toggle: (name) =>
      mutate({ key: "followedBroadcastPlayers", value: toggledFollow(followed, name) })
  };
}
