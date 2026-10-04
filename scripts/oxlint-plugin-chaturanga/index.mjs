// Chaturanga's own lint rules, loaded by oxlint.config.ts as a JS plugin. Each rule encodes a
// mistake that kept recurring here, and its message names the supported fix. Tested with valid and
// invalid fixtures in scripts/oxlint-plugin-chaturanga.test.mjs.

const DIRECTIVE = /^\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?=\s|$)(.*)$/s;

/**
 * Every lint-disable comment names the rules it silences and says, after `--`, why the exception
 * is safe. A bare or blanket disable hides future problems along with the reviewed one.
 */
const disableNeedsReason = {
  meta: {
    type: "suggestion",
    docs: { description: "Require a rule name and a `-- reason` on every lint-disable comment." },
    messages: {
      noRule:
        "Name the rule this comment silences, e.g. `// oxlint-disable-next-line react/exhaustive-deps -- reason`; a blanket disable hides every other problem on the line too.",
      noReason:
        "Say why this exception is safe after ` -- `, e.g. `// oxlint-disable-next-line no-control-regex -- matches the C0 controls a PGN header may not contain`."
    },
    schema: []
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = DIRECTIVE.exec(comment.value);
          if (!match) continue;
          const [rules, ...reason] = match[1].split(/\s--\s|\s--$/);
          if (!rules.trim()) {
            context.report({ loc: comment.loc, messageId: "noRule" });
          } else if (!reason.join(" -- ").trim()) {
            context.report({ loc: comment.loc, messageId: "noReason" });
          }
        }
      }
    };
  }
};

function isPromiseExecutor(fn) {
  const parent = fn.parent;
  return (
    parent?.type === "NewExpression" &&
    parent.callee.type === "Identifier" &&
    parent.callee.name === "Promise" &&
    parent.arguments[0] === fn
  );
}

function isSetTimeout(callee) {
  if (callee.type === "Identifier") return callee.name === "setTimeout";
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.name === "setTimeout" &&
    callee.object.type === "Identifier" &&
    ["globalThis", "window"].includes(callee.object.name)
  );
}

/** `resolve` itself, or a callback whose whole body calls it: `() => resolve()`. */
function settles(callback, resolveName) {
  if (!callback) return false;
  if (callback.type === "Identifier") return callback.name === resolveName;
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
    return false;
  }
  const body =
    callback.body.type === "BlockStatement" && callback.body.body.length === 1
      ? callback.body.body[0].expression
      : callback.body;
  return (
    body?.type === "CallExpression" &&
    body.callee.type === "Identifier" &&
    body.callee.name === resolveName
  );
}

/** A sleep is awaited or handed out: `await new Promise(…)`, or a helper that returns one. */
function isSleepUse(promise) {
  const parent = promise.parent;
  return (
    parent?.type === "AwaitExpression" ||
    parent?.type === "ReturnStatement" ||
    (parent?.type === "ArrowFunctionExpression" && parent.body === promise)
  );
}

/**
 * A test that sleeps for real (`await new Promise((resolve) => setTimeout(resolve, 50))`) is slow
 * and hides races: it passes only while the awaited work happens to finish in time. A zero delay
 * is allowed: it yields one macrotask, which is a scheduling milestone rather than a guess. A
 * timer kept as a deadline (a promise raced against the real outcome) isn't a sleep.
 */
const noTestSleep = {
  meta: {
    type: "problem",
    docs: { description: "Disallow real sleeps in tests." },
    messages: {
      sleep:
        "Don't sleep in a test: await the milestone itself (the promise, an event, or `vi.waitFor(() => …)` for a condition), or use `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync(ms)` for timer behaviour. Playwright specs use `expect.poll` or a locator assertion."
    },
    schema: []
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isSetTimeout(node.callee)) return;
        const [callback, delay] = node.arguments;
        if (delay?.type === "Literal" && delay.value === 0) return;
        for (let fn = node.parent; fn; fn = fn.parent) {
          if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") continue;
          if (!isPromiseExecutor(fn)) continue;
          const resolve = fn.params[0];
          if (
            resolve?.type === "Identifier" &&
            settles(callback, resolve.name) &&
            isSleepUse(fn.parent)
          ) {
            context.report({ node, messageId: "sleep" });
          }
          return;
        }
      }
    };
  }
};

export default {
  meta: { name: "chaturanga" },
  rules: {
    "disable-needs-reason": disableNeedsReason,
    "no-test-sleep": noTestSleep
  }
};
