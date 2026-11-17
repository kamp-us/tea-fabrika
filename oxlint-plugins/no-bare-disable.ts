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
// The Effect checker (`@effect/tsgo`) has its own ignore comment, held the same way (0565, law L3
// of docs/plan/quests/effect-sweep-PLAN.md): a line comment of its own that starts with the
// next-line form, names each check with its level, then gives ` -- <why>`, as in
// `// <directive>-next-line preferEffectArray:off -- the platform hands back a plain array`, where
// `<directive>` is the checker's `@effect-` word. `@effect/tsgo` 0.63.0 reads that word anywhere in
// the text (seen 2026-11-15): after other words in a comment, inside a `/** */` block, inside a
// string, where it silenced a hit further down. So the rule reads the whole text, and any place the
// word stands outside such a comment is refused, the file-wide form and `skip-file` too. The checker
// also reads a `<check>:<level>` inside the reason as one more check to silence, so a reason that
// holds one is refused: the ` -- <why>` tail is no part of the directive only while it holds none.
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

// Built from two pieces, so this file's own text never holds the word the checker reads.
const WORD = ["@effect", "diagnostics"].join("-");

const LEVEL = "(?:off|error|warning|message|suggestion|skip-file)";

const CHECK = String.raw`\w+:${LEVEL}`;

const DIRECTIVE = new RegExp(
  String.raw`^\s*${WORD}-next-line[ \t]+${CHECK}(?:[ \t]*,?[ \t]*${CHECK})*[ \t]+--[ \t]+(\S.*)$`,
);

const CHECK_IN_REASON = new RegExp(String.raw`[\w*]+:${LEVEL}(?![\w-])`);

const START = { line: 1, column: 0 };

const OXLINT_SHAPE = "`// oxlint-disable-next-line <rule> -- <why>`";

const CHECKER_SHAPE = `\`// ${WORD}-next-line <check>:<level> -- <why>\``;

/** What is wrong with the checker's directive in one line comment's text, or null when it is right. */
const directiveProblem = (comment: string): string | null => {
  const found = DIRECTIVE.exec(comment);

  if (found === null) {
    return `needs the next-line form, its checks, each with a level, and a reason: ${CHECKER_SHAPE}`;
  }

  return CHECK_IN_REASON.test(found[1] ?? "")
    ? `holds a <check>:<level> in its reason, which the checker also obeys: ${CHECKER_SHAPE}`
    : null;
};

type Comment = { readonly type: string; readonly value: string; readonly range: readonly [number, number] };

/** Each place in the text the checker reads its directive, with what is wrong there. */
const checkerProblems = (text: string, comments: ReadonlyArray<Comment>): ReadonlyArray<readonly [number, string]> => {
  const own = new Map(
    comments.flatMap((comment) => {
      const at = comment.value.search(/\S/);

      // `//` plus the spaces before the word.
      return comment.type === "Line" && comment.value.startsWith(WORD, at)
        ? [[comment.range[0] + 2 + at, comment]]
        : [];
    }),
  );

  return [...text.matchAll(new RegExp(WORD, "g"))].flatMap(({ index }): ReadonlyArray<readonly [number, string]> => {
    const comment = own.get(index);

    const wrong =
      comment === undefined
        ? `is the checker's word outside a line comment of its own, which the checker still obeys: ${CHECKER_SHAPE}`
        : directiveProblem(comment.value);

    return wrong === null ? [] : [[index, wrong]];
  });
};

const problem = (comment: string): string | null => {
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
      const line = (index: number) => context.sourceCode.getLocFromIndex(index).line;

      for (const [index, wrong] of checkerProblems(context.sourceCode.text, context.sourceCode.getAllComments())) {
        context.report({
          loc: { start: START, end: START },
          message: `The ignore comment on line ${line(index)} ${wrong}.`,
        });
      }

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
