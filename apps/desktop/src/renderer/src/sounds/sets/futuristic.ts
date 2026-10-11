import type { SoundFiles } from "../sound-events";
import move from "../../assets/sounds/futuristic/Move.mp3";
import capture from "../../assets/sounds/futuristic/Capture.mp3";
import check from "../../assets/sounds/futuristic/Check.mp3";
import victory from "../../assets/sounds/futuristic/Victory.mp3";
import defeat from "../../assets/sounds/futuristic/Defeat.mp3";
import draw from "../../assets/sounds/futuristic/Draw.mp3";
import notify from "../../assets/sounds/futuristic/GenericNotify.mp3";
import lowTime from "../../assets/sounds/futuristic/LowTime.mp3";

/**
 * Lichess's Futuristic set, by Enigmahack (AGPLv3+, see SOUND_CREDITS.md). No castling or error sound;
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
