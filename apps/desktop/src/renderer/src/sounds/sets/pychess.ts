import type { SoundFiles } from "../sound-events";
import move from "../../assets/sounds/pychess/move1.mp3";
import capture from "../../assets/sounds/pychess/capture1.mp3";
import check from "../../assets/sounds/pychess/check1.mp3";
import castle from "../../assets/sounds/pychess/castle.mp3";
import victory from "../../assets/sounds/pychess/win1.mp3";
import defeat from "../../assets/sounds/pychess/lose1.mp3";
import draw from "../../assets/sounds/pychess/draw1.mp3";
import start from "../../assets/sounds/pychess/start1.mp3";
import error from "../../assets/sounds/pychess/invalid.mp3";

/**
 * PyChess's sounds (GPLv3, see credits/SOUNDS.md). Its alarm and success sounds are recordings
 * from elsewhere whose licences PyChess doesn't state, so it has no low-time or solved sound here.
 */
export const files: SoundFiles = {
  move,
  capture,
  check,
  castle,
  victory,
  defeat,
  draw,
  start,
  error
};
