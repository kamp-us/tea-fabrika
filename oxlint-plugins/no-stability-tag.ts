// E1 of the Effect-check sweep (0574): no doc block of ours carries `@stability` until libfabrika's
// first release, since the tag said `unstable` on every export and the checker's `unstableApiUsage`
// counted each use of our own code as a hit. The rule reads every `/** */` block and reports each
// `@stability` line, with a safe fix that deletes the line, and the ` *` line just above ` */` when
// the deletion leaves one. `pnpm format` applies it (`lint.ts --fix`), so the sweep deletes the tags
// with a tool and no hand edit or find-and-replace over the tree.
//
// Where it reads: `.oxlintrc.json` turns it on for `next/`, `.agents/`, `.github/ci/` and
// `oxlint-plugins/`, and off for the 16 files of pull request 1366, which E60 does once that
// branch is in. `jsdocs` keeps passing a tag meanwhile, so the two rules never disagree.
//
// What it cannot see: a tag written on the opening line of a block (`/** @stability x */`) is
// reported with no fix, since deleting the line would delete more than the tag. The word in the
// middle of a sentence is prose and passes.
import type { CreateRule } from "@oxlint/plugins";

const MESSAGE = "No @stability tag until libfabrika's first release (0574, E1). Fix: `pnpm format` deletes the line.";

// A line that holds only the tag: ` * @stability unstable`.
const TAG_LINE = /^[ \t]*\*[ \t]*@stability\b.*$/;

// A tag anywhere after a `*` or the block's opening, for the report with no fix.
const LOOSE = /(?:\/\*\*|\*)[ \t]*@stability\b/;

const BLANK_STAR = /^[ \t]*\*[ \t]*$/;

const CLOSER = /^[ \t]*\*\/[ \t]*$/;

export const noStabilityTag: CreateRule = {
  meta: { type: "suggestion", fixable: "code" },
  create(context) {
    const { sourceCode } = context;

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Block" || !comment.value.startsWith("*")) {
            continue;
          }

          const [start, end] = comment.range;
          const lines = sourceCode.text.slice(start, end).split("\n");
          // The offset each line starts at, in the file.
          const starts: number[] = [];
          let at = start;

          for (const line of lines) {
            starts.push(at);
            at += line.length + 1;
          }

          lines.forEach((line, i) => {
            if (i > 0 && TAG_LINE.test(line)) {
              // The blank ` *` before the closing ` */` goes with the last tag line.
              const blankBefore = BLANK_STAR.test(lines[i - 1] ?? "") && CLOSER.test(lines[i + 1] ?? "");
              const from = blankBefore ? (starts[i - 1] ?? starts[i] ?? start) : (starts[i] ?? start);
              const to = (starts[i] ?? start) + line.length + 1;

              context.report({
                loc: {
                  start: { line: sourceCode.getLocFromIndex(starts[i] ?? start).line, column: 0 },
                  end: { line: sourceCode.getLocFromIndex(starts[i] ?? start).line, column: line.length },
                },
                message: MESSAGE,
                fix: (fixer) => fixer.removeRange([from, to]),
              });
            } else if (LOOSE.test(line)) {
              const lineNumber = sourceCode.getLocFromIndex(starts[i] ?? start).line;

              context.report({
                loc: { start: { line: lineNumber, column: 0 }, end: { line: lineNumber, column: line.length } },
                message: "No @stability tag until libfabrika's first release (0574, E1). Delete it by hand.",
              });
            }
          });
        }
      },
    };
  },
};
