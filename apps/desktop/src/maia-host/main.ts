/*
 * Chaturanga: the Maia 3 host page.
 * Copyright (C) 2026 Ayush Porwal
 *
 * A thin wrapper around CSSLab's Maia 3 engine from the Maia platform
 * (https://github.com/CSSLab/maia-platform-frontend, GPL-3.0, Copyright the CSSLab authors),
 * vendored unmodified in vendor/csslab-maia (see PROVENANCE.md there). This page runs their code
 * in the environment it was written for (a web page with their worker and ONNX Runtime files at
 * their paths) inside a hidden, sandboxed window, and answers main's requests with it.
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. It is distributed WITHOUT ANY WARRANTY; see the
 * GNU General Public License (the LICENSE file) for details.
 */
import type { MaiaHostRequest } from "@chaturanga/shared/engine/maia3-host";
import { isRecord } from "@chaturanga/shared/types/guards";
import Maia from "../../vendor/csslab-maia/src/lib/engine/maia";
import { MAIA_MODEL_URL_PATH, type MaiaHostStatus } from "./protocol";

const bridge = window.maiaHost;

let markReady: () => void = () => undefined;
let markFailed: (error: Error) => void = () => undefined;
/** Settles once CSSLab's worker has a model session (or failed to get one). */
const ready = new Promise<void>((resolve, reject) => {
  markReady = resolve;
  markFailed = reject;
});
// Requests await it; an unhandled rejection here would only duplicate the error main is sent.
ready.catch(() => undefined);

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The model's state as CSSLab's code last reported it (sent with every update). */
let status: MaiaHostStatus = "loading";

function fail(error: string): void {
  status = "error";
  bridge.post({ type: "status", status, error });
  markFailed(new Error(error));
}

const maia = new Maia({
  model: MAIA_MODEL_URL_PATH,
  modelVersion: "3",
  setStatus: (next: MaiaHostStatus) => {
    // An error arrives with its message through setError.
    if (next === "error") return;
    status = next;
    bridge.post({ type: "status", status });
    if (next === "ready") markReady();
    // No cached model (the session's storage starts empty): their download fetches it from
    // MAIA_MODEL_URL_PATH, which main serves from the model file on disk.
    if (next === "no-cache") maia.downloadModel().catch((error: unknown) => fail(failure(error)));
  },
  setProgress: (progress) => bridge.post({ type: "status", status, progress }),
  setError: fail
});

function isNumberList(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

/** Main's request, checked (main validates the FENs and ratings before sending). */
function evaluateRequest(value: unknown): MaiaHostRequest | null {
  if (!isRecord(value)) return null;
  const { type, id, boards, eloSelfs, eloOppos } = value;
  if (type !== "evaluate" || typeof id !== "number" || !Number.isInteger(id)) return null;
  if (!Array.isArray(boards) || !boards.every((board) => typeof board === "string")) return null;
  if (!isNumberList(eloSelfs, boards.length) || !isNumberList(eloOppos, boards.length)) return null;
  return { type, id, boards, eloSelfs, eloOppos };
}

async function evaluate(request: MaiaHostRequest): Promise<void> {
  try {
    await ready;
    const { result, time } = await maia.batchEvaluateMaia3(
      request.boards,
      request.eloSelfs,
      request.eloOppos
    );
    console.debug(`Maia 3: ${request.boards.length} position(s) in ${Math.round(time)} ms`);
    bridge.post({
      type: "result",
      id: request.id,
      result: result.map(({ policy, value }) => ({ policy, value }))
    });
  } catch (error) {
    bridge.post({ type: "error", id: request.id, message: failure(error) });
  }
}

/** One evaluation at a time: CSSLab's worker runs one inference session. */
let queue = Promise.resolve();

bridge.listen((value) => {
  const request = evaluateRequest(value);
  if (!request) return;
  queue = queue.then(() => evaluate(request));
});
