import type { SoundFiles } from "../sound-events";
import move from "../../assets/sounds/sfx/Move.mp3";
import capture from "../../assets/sounds/sfx/Capture.mp3";
import check from "../../assets/sounds/sfx/Check.mp3";
import victory from "../../assets/sounds/sfx/Victory.mp3";
import defeat from "../../assets/sounds/sfx/Defeat.mp3";
import draw from "../../assets/sounds/sfx/Draw.mp3";
import notify from "../../assets/sounds/sfx/GenericNotify.mp3";
import lowTime from "../../assets/sounds/sfx/LowTime.mp3";

/**
 * Lichess's SFX set, by Enigmahack (AGPLv3+, see credits/SOUNDS.md). No castling or error sound;
 * Lichess plays its notification for a game start and a confirmation, so this does too.
 */
export const files: SoundFiles = {
  move,
  capture,
  check,
  victory,
  defeat,
  draw,
  start: notify,
  correct: notify,
  lowTime
};
