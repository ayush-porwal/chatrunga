// Valid and invalid fixtures for Chaturanga's own lint rules (scripts/oxlint-plugin-chaturanga).
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./oxlint-plugin-chaturanga/index.mjs";

// node:test returns a promise from each; the runner awaits it, RuleTester doesn't need to.
RuleTester.describe = (text, fn) => void describe(text, fn);
RuleTester.it = (text, fn) => void it(text, fn);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("disable-needs-reason", plugin.rules["disable-needs-reason"], {
  valid: [
    "// oxlint-disable-next-line no-control-regex -- matches the C0 controls a header may not contain\nconst a = 1;",
    "// eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the list\nconst b = 1;",
    "/* oxlint-disable no-console -- a CLI script prints its report */\nconst c = 1;",
    "const d = 1; // oxlint-disable-line no-debugger -- reproduces a reported hang",
    // Not directives: ordinary comments that mention one, and re-enabling.
    "// Use `oxlint-disable-next-line rule -- reason` sparingly.\nconst e = 1;",
    "// oxlint-enable no-console\nconst f = 1;"
  ],
  invalid: [
    {
      code: "// oxlint-disable-next-line no-control-regex\nconst a = 1;",
      errors: [{ messageId: "noReason" }]
    },
    {
      code: "// eslint-disable-next-line react-hooks/exhaustive-deps --\nconst b = 1;",
      errors: [{ messageId: "noReason" }]
    },
    {
      code: "// oxlint-disable-next-line\nconst c = 1;",
      errors: [{ messageId: "noRule" }]
    },
    {
      code: "/* eslint-disable */\nconst d = 1;",
      errors: [{ messageId: "noRule" }]
    },
    {
      code: "// oxlint-disable-next-line -- no rule named, only a reason\nconst e = 1;",
      errors: [{ messageId: "noRule" }]
    }
  ]
});

tester.run("no-test-sleep", plugin.rules["no-test-sleep"], {
  valid: [
    // A zero delay yields one macrotask: a scheduling milestone, not a guess.
    "await new Promise((resolve) => setTimeout(resolve, 0));",
    // Fake timers and awaited milestones.
    "vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(250);",
    "await vi.waitFor(() => expect(done).toBe(true));",
    // A timer that isn't a sleep: the promise settles on something else.
    "await new Promise((resolve) => { emitter.once('ready', resolve); setTimeout(() => emitter.emit('timeout'), 50); });",
    // The code under test may use timers.
    "const timer = setTimeout(flush, 250);",
    // A deadline raced against the outcome, not a sleep.
    "const timedOut = new Promise((resolve) => setTimeout(() => resolve(false), 5000)); await Promise.race([closed, timedOut]);"
  ],
  invalid: [
    {
      code: "await new Promise((resolve) => setTimeout(resolve, 50));",
      errors: [{ messageId: "sleep" }]
    },
    {
      code: "await new Promise((r) => { setTimeout(r, 200); });",
      errors: [{ messageId: "sleep" }]
    },
    {
      code: "await new Promise((resolve) => setTimeout(() => resolve(), DELAY_MS));",
      errors: [{ messageId: "sleep" }]
    },
    {
      code: "await new Promise(function (resolve) { globalThis.setTimeout(resolve, 20); });",
      errors: [{ messageId: "sleep" }]
    },
    {
      code: "const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));",
      errors: [{ messageId: "sleep" }]
    }
  ]
});
