// An ignore comment names its rules and says why: `// oxlint-disable-next-line <rule> -- <why>`.
//
// Why: oxlint takes `// oxlint-disable-next-line` with no rule as "every rule", and asks for no
// reason. So a bare comment would silence the secret rules with exit 0. Biome failed on a missing
// reason, and this keeps that. `eslint-disable` does the same job in oxlint, so it is refused
// outright: one spelling, which a search can find.
//
// What it refuses: any comment that oxlint reads as a disable, in all three forms (the file from
// here on, the next line, this line), with no rule named, with no ` -- <why>`, or spelled `eslint-`.
//
// The Effect checker (`@effect/tsgo`) has its own ignore comment, and it is held the same way
// (0565, law L3 of docs/plan/quests/effect-sweep-PLAN.md): only the next-line form, naming each
// check with its level, then ` -- <why>`, such as `@effect-diagnostics-next-line
// preferEffectArray:off -- the platform hands back a plain array`. The file-wide form and
// `skip-file` are refused outright, since one comment would hide a whole file. The checker reads a
// directive wherever `//` or `/*` comes before it, even inside a comment or a string (seen with
// `@effect/tsgo` 0.63.0, 2026-11-15), so each piece of a comment after one counts too. A string is
// no comment here; the checker's own "directive has no effect" fails the type check on one.
//
// What it cannot see: whether the reason is a good one. `-- x` passes. A person reads those.
//
// Where it reports, and why there: at the very start of the file, with the real line in the message.
// A report on the comment's own line would be silenced by that same comment. Oxlint never silences
// an empty range at offset 0, and `plants.test.ts` fails if a new version does.
import type { CreateRule } from "@oxlint/plugins";

// No word boundary after the keyword: oxlint reads `oxlint-disablefoo` as naming a rule `foo`.
const DISABLE = /^\s*(oxlint|eslint)-disable(?:-next-line|-line)?(.*)$/s;
// A rule name never holds `--`: oxlint ends the rule list at the first `--`, so `-- -- why` or
// `--- -- why` names no rule, which means every rule.
const NAME = String.raw`[\w@./]+(?:-[\w@./]+)*`;
const NAMED_WITH_WHY = new RegExp(String.raw`^\s+${NAME}(?:\s*,\s*${NAME})*\s+--\s+\S`, "s");

const CHECKER = /^\s*@effect-diagnostics(-next-line)?(?![\w-])(.*)$/s;
const LEVEL = "(?:off|error|warning|message|suggestion)";
const CHECK = String.raw`\w+:${LEVEL}`;
const CHECKS_WITH_WHY = new RegExp(String.raw`^\s+${CHECK}(?:\s*,?\s*${CHECK})*\s+--\s+\S`, "s");

const START = { line: 1, column: 0 };

const OXLINT_SHAPE = "`// oxlint-disable-next-line <rule> -- <why>`";
const CHECKER_SHAPE = "`// @effect-diagnostics-next-line <check>:<level> -- <why>`";

const checkerProblem = (comment: string): string | null => {
  const found = CHECKER.exec(comment);

  if (found === null) {
    return null;
  }

  const [, nextLine, rest = ""] = found;

  if (nextLine === undefined) {
    return `is the file-wide form of the Effect checker's. Write ${CHECKER_SHAPE}, for one line`;
  }

  return CHECKS_WITH_WHY.test(rest) ? null : `needs its checks, each with a level, and a reason: ${CHECKER_SHAPE}`;
};

const problem = (comment: string): string | null => {
  const checker =
    [comment, ...comment.split(/\/\/|\/\*/).slice(1)].map(checkerProblem).find((found) => found !== null) ?? null;

  if (checker !== null) {
    return checker;
  }

  const found = DISABLE.exec(comment);

  if (found === null) {
    return null;
  }

  const [, tool = "", rest = ""] = found;

  if (tool === "eslint") {
    return `says \`eslint-disable\`. Write \`oxlint-disable\`, the one spelling: ${OXLINT_SHAPE}`;
  }

  return NAMED_WITH_WHY.test(rest) ? null : `needs its rules and a reason: ${OXLINT_SHAPE}`;
};

export const noBareDisable: CreateRule = {
  create: (context) => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        const wrong = problem(comment.value);

        if (wrong === null) {
          continue;
        }

        context.report({
          loc: { start: START, end: START },
          message: `The ignore comment on line ${context.sourceCode.getLocFromIndex(comment.range[0]).line} ${wrong}.`,
        });
      }
    },
  }),
};
