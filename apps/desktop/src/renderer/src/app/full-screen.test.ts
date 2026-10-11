import { describe, expect, it } from "vitest";
import { followFullScreen } from "./full-screen";

/** An appearance bridge whose answer the test settles, and whose change events it sends. */
function fakeAppearance() {
  let listener: ((fullScreen: boolean) => void) | null = null;
  let answer!: { resolve: (value: boolean) => void; reject: (error: unknown) => void };
  const asked = new Promise<boolean>((resolve, reject) => (answer = { resolve, reject }));
  return {
    appearance: {
      onFullScreenChanged: (callback: (fullScreen: boolean) => void) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
      isFullScreen: () => asked
    },
    change: (fullScreen: boolean) => listener?.(fullScreen),
    subscribed: () => listener !== null,
    answer,
    /** Lets the answer's handlers run. */
    settled: () =>
      asked.then(
        () => undefined,
        () => undefined
      )
  };
}

function follow() {
  const fake = fakeAppearance();
  const reported: boolean[] = [];
  const stop = followFullScreen(fake.appearance, (value) => reported.push(value));
  return { ...fake, reported, stop };
}

describe("followFullScreen", () => {
  it("reports the state now, then each change", async () => {
    const { answer, settled, change, reported } = follow();
    answer.resolve(true);
    await settled();
    change(false);
    expect(reported).toStrictEqual([true, false]);
  });

  it("lets a change that arrives before the answer win over it", async () => {
    const { answer, settled, change, reported } = follow();
    change(true);
    answer.resolve(false);
    await settled();
    expect(reported).toStrictEqual([true]);
  });

  it("ignores an answer that arrives after it stopped, and stops listening", async () => {
    const { answer, settled, change, subscribed, reported, stop } = follow();
    expect(subscribed()).toBe(true);
    stop();
    expect(subscribed()).toBe(false);
    answer.resolve(true);
    await settled();
    change(true);
    expect(reported).toStrictEqual([]);
  });

  it("ignores a failed answer and still follows changes", async () => {
    const { answer, settled, change, reported } = follow();
    answer.reject(new Error("window closed"));
    await settled();
    change(true);
    expect(reported).toStrictEqual([true]);
  });
});
