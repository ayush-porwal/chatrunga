import type { SoundFiles } from "../sound-events";
import move from "../../assets/sounds/piano/Move.mp3";
import capture from "../../assets/sounds/piano/Capture.mp3";
import check from "../../assets/sounds/piano/Check.mp3";
import victory from "../../assets/sounds/piano/Victory.mp3";
import defeat from "../../assets/sounds/piano/Defeat.mp3";
import draw from "../../assets/sounds/piano/Draw.mp3";
import notify from "../../assets/sounds/piano/GenericNotify.mp3";
import lowTime from "../../assets/sounds/piano/LowTime.mp3";

/**
 * Lichess's Piano set, by Enigmahack (AGPLv3+, see credits/SOUNDS.md). No castling or error sound;
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
