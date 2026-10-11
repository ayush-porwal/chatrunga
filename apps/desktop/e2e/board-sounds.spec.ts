// The board's sounds through the built app: each move on the board plays the sound of what it is
// (a capture, a capture that gives check, a check), with the default set (Lichess SFX); a step
// back plays nothing and a step forward again plays the move it shows. The sounds played are read
// from HTMLMediaElement.play, wrapped in the page. How to run them: playwright.config.ts.
import type { Page } from "@playwright/test";
import { clickSquare, expect, importPgnFile, skipWelcome, test } from "./app";
import { writePgn } from "./fixtures";

const OPENING_PGN = `[Event "Board sounds"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 d5 *
`;

/**
 * Records the file of every sound the page plays, in order (built names: `Capture-<hash>.mp3`).
 * The sounds' elements are never in the document (no events reach it), so `play` itself is wrapped.
 */
async function recordSounds(page: Page): Promise<void> {
  await page.evaluate(() => {
    const played: string[] = [];
    (window as unknown as { playedSounds: string[] }).playedSounds = played;
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
    const play = original?.value as ((this: HTMLMediaElement) => Promise<void>) | undefined;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const file = (this.currentSrc || this.src).split("/").pop() ?? "";
      // The set's name for the sound, without the build's content hash.
      played.push(file.replace(/-[\w-]+(?=\.mp3$)/, ""));
      return play ? play.call(this) : Promise.resolve();
    };
  });
}

const playedSounds = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { playedSounds: string[] }).playedSounds]);

/** Plays `uci` on the board and waits for the sound it makes: then all played so far are `sounds`. */
async function playAndHear(page: Page, uci: string, sounds: string[]): Promise<void> {
  await clickSquare(page, uci.slice(0, 2));
  await clickSquare(page, uci.slice(2, 4));
  await expect.poll(() => playedSounds(page)).toStrictEqual(sounds);
}

test("moves on the board play a capture, a check and a capture with check as what they are", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await recordSounds(page);
  await importPgnFile(app, page, writePgn(profile, "board-sounds.pgn", OPENING_PGN));
  const navigation = page.getByRole("navigation", { name: "Move navigation" });
  await expect(navigation).toBeVisible({ timeout: 20_000 });

  await playAndHear(page, "e4d5", ["Capture.mp3"]);
  await playAndHear(page, "d8d5", ["Capture.mp3", "Capture.mp3"]);
  await playAndHear(page, "b1c3", ["Capture.mp3", "Capture.mp3", "Move.mp3"]);
  const check = ["Capture.mp3", "Capture.mp3", "Move.mp3", "Check.mp3"];
  await playAndHear(page, "d5e5", check);

  // A step back is silent; the step forward again plays the check it shows (and nothing else).
  await navigation.getByRole("button", { name: "Previous move", exact: true }).click();
  await navigation.getByRole("button", { name: "Next move", exact: true }).click();
  await expect.poll(() => playedSounds(page)).toStrictEqual([...check, "Check.mp3"]);

  // 5. Be2 Bg4 6. d4 Bxe2 7. Ngxe2: then the queen takes on e2 with check.
  const sounds = [...check, "Check.mp3"];
  for (const [uci, sound] of [
    ["f1e2", "Move.mp3"],
    ["c8g4", "Move.mp3"],
    ["d2d4", "Move.mp3"],
    ["g4e2", "Capture.mp3"],
    ["g1e2", "Capture.mp3"]
  ] as const) {
    sounds.push(sound);
    await playAndHear(page, uci, [...sounds]);
  }
  await playAndHear(page, "e5e2", [...sounds, "Check.mp3"]);
});
