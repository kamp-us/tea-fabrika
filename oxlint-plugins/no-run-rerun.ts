// no fixer: dropping a rerun needs judgment; the fix is a fresh run on current main through WorkflowRuns.dispatch.
// R10 of the sev runbooks plan (0542, 0611): lead tooling starts no rerun. A rerun tests the old merge of
// main, and leaving a sev starts a fresh run on current main instead; the header of
// `.agents/skills/sev/scripts/WorkflowRuns.ts` says why. `.oxlintrc.json` turns this on for `.agents/skills/**`.
//
// What it refuses, each on the line it is on:
//   a. a call whose callee is `rerun`, `x.rerun`, `x?.rerun`, `x["rerun"]`, or a name that is `rerun`
//      and then an upper-case letter (`rerunFailedJobs`, `api.rerunJob`);
//   b. a string, or the raw text of a template (each quasi), with an API path segment `/rerun` as a
//      whole word, so `/rerun-failed-jobs` holds it too;
//   c. a string, or template text, with the gh words `run rerun`;
//   d. argv split into strings: `"rerun"` right after `"run"` in one array literal or one call's arguments.
//
// What it cannot see: a rerun built from parts it cannot read (`"/re" + "run"`, a variable that holds
// `"rerun"` and is passed as an argument), a function named `rerun` that is passed on as a value and
// called there, and `gh` called through a shell script. It reads every string, so an import path that
// ends in `/rerun` fires too. Comments are not read, so a word in a comment passes.
import type { CreateRule, ESTree } from "@oxlint/plugins";

const MESSAGE =
  "No rerun in lead tooling (0542, 0611): a rerun tests the old merge of main. Start a fresh run on current main with WorkflowRuns.dispatch.";

/** (b) and (c): `/rerun` as a whole word in an API path, or the gh words `run rerun`. */
const REFUSED_TEXT = /\/rerun(?![A-Za-z0-9_])|\brun\s+rerun\b/;

/** (a): `rerun` alone, or a name that starts with `rerun` and then an upper-case letter. */
const RERUN_NAME = /^rerun(?:$|[A-Z])/;

/** The name a callee goes by: `rerun`, `api.rerunJob`, `runs["rerun"]`. `null` for any other shape. */
const calleeName = (callee: ESTree.Node): string | null => {
  if (callee.type === "Identifier") {
    return callee.name;
  }

  if (callee.type !== "MemberExpression") {
    return null;
  }

  if (callee.computed) {
    const { property } = callee;

    return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
  }

  return callee.property.type === "Identifier" ? callee.property.name : null;
};

/** A string literal with exactly this value. */
const isStringLiteral = (node: ESTree.Node | null | undefined, value: string): boolean =>
  node?.type === "Literal" && node.value === value;

export const noRunRerun: CreateRule = {
  meta: { type: "problem" },
  create(context) {
    const { sourceCode } = context;

    const refuse = (node: ESTree.Node) => {
      context.report({ node, message: MESSAGE });
    };

    // (d): a "rerun" right after a "run", in the same array literal or the same argument list.
    const argv = (items: ReadonlyArray<ESTree.Node | null>) => {
      items.forEach((item, i) => {
        if (item !== null && isStringLiteral(item, "rerun") && isStringLiteral(items[i - 1], "run")) {
          refuse(item);
        }
      });
    };

    return {
      CallExpression(node) {
        const name = calleeName(node.callee);

        if (name !== null && RERUN_NAME.test(name)) {
          refuse(node);
        }

        argv(node.arguments);
      },
      ArrayExpression(node) {
        argv(node.elements);
      },
      Literal(node) {
        if (typeof node.value === "string" && REFUSED_TEXT.test(node.value)) {
          refuse(node);
        }
      },
      TemplateElement(node) {
        // The quasi's raw text. Its range starts at the backtick or `}` before the text, so the text
        // is found from there, as no-stage-word.ts does.
        const { raw } = node.value;
        const found = REFUSED_TEXT.exec(raw);

        if (found === null) {
          return;
        }

        const from = sourceCode.text.indexOf(raw, node.range[0]);

        if (from < 0) {
          refuse(node);

          return;
        }

        // A quasi can run over several lines, so the report names the line the refused text is on.
        context.report({
          loc: {
            start: sourceCode.getLocFromIndex(from + found.index),
            end: sourceCode.getLocFromIndex(from + found.index + found[0].length),
          },
          message: MESSAGE,
        });
      },
    };
  },
};
