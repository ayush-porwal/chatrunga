import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The preload and the main process name each IPC channel as a string. This keeps the two sides in
 * step: every channel the preload calls has a handler, every handler is reachable, and every event
 * the preload listens to is sent by main.
 */
const src = join(__dirname, "../..");

function sources(dir: string): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .flatMap((path) => (statSync(path).isDirectory() ? [sources(path)] : /\.ts$/.test(path) && !/\.test\.ts$/.test(path) ? [readFileSync(path, "utf8")] : []))
    .join("\n");
}

const matches = (text: string, pattern: RegExp) => new Set([...text.matchAll(pattern)].map((match) => match[1]));

const preload = sources(join(src, "preload"));
const main = sources(join(src, "main"));

describe("IPC channels", () => {
  it("every request the preload makes has a handler in main, and every handler is used", () => {
    const requested = matches(preload, /ipcRenderer\.(?:invoke|sendSync|send)\("([\w:]+)"/g);
    const handled = matches(main, /ipcMain\.(?:handle|on|once)\("([\w:]+)"/g);
    expect([...requested].filter((channel) => !handled.has(channel))).toEqual([]);
    expect([...handled].filter((channel) => !requested.has(channel))).toEqual([]);
  });

  it("every event the preload listens to is sent by main", () => {
    const listened = matches(preload, /(?:subscribe(?:<[^>]*>)?|ipcRenderer\.on)\("([\w:]+)"/g);
    const sent = new Set([
      ...matches(main, /(?:broadcast|webContents\.send|contents\.send)\("([\w:]+)"/g),
      // The engine events are relayed from a table (ENGINE_EVENT_CHANNELS in register.ts).
      ...matches(main, /:\s*"((?:engine|review):\w+)"/g)
    ]);
    expect([...listened].filter((channel) => !sent.has(channel))).toEqual([]);
  });

  it("exposes the repertoire namespace, including its lookups and the change event", () => {
    const requested = matches(preload, /ipcRenderer\.invoke\("(repertoires:\w+)"/g);
    for (const lookup of ["getChapter", "getDecision", "getOccurrences", "compareGame"]) {
      expect(requested.has(`repertoires:${lookup}`)).toBe(true);
    }
    expect(requested.size).toBe(30);
    expect(matches(preload, /subscribe(?:<[^>]*>)?\("(repertoires:\w+)"/g)).toEqual(new Set(["repertoires:changed"]));
  });
});
