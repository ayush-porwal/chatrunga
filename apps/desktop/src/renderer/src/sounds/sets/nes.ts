import type { SoundFiles } from "../sound-events";
import move from "../../assets/sounds/nes/Move.mp3";
import capture from "../../assets/sounds/nes/Capture.mp3";
import check from "../../assets/sounds/nes/Check.mp3";
import victory from "../../assets/sounds/nes/Victory.mp3";
import defeat from "../../assets/sounds/nes/Defeat.mp3";
import draw from "../../assets/sounds/nes/Draw.mp3";
import notify from "../../assets/sounds/nes/GenericNotify.mp3";
import lowTime from "../../assets/sounds/nes/LowTime.mp3";

/**
 * Lichess's NES set, by Enigmahack (AGPLv3+, see SOUND_CREDITS.md). No castling or error sound;
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
