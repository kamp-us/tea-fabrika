// L5 of the Reflect ban (decision 0554, docs/plan/quests/reflect-ban-PLAN.md): no ignore comment
// lets a `Reflect.get`, `Reflect.set` or `Reflect.has` through oxlint's `no-restricted-properties`
// outside the lines the plan names. Oxlint honors any ignore comment with a rule and a reason, so
// without this rule a later change could bring a call back under one and the ban would not see it.
//
// The known way is `eslint-comments/no-restricted-disable`, which refuses every ignore comment for
// a rule. It does not fit: the same rule holds the `JSON.parse` guard, whose test oracles keep a
// parse under an ignore comment on purpose (README.md, "no-restricted-properties"). So this rule
// reads which lines a comment covers, and counts a comment only when a covered line names `Reflect`.
//
// What it counts: an ignore comment in any of oxlint's forms (the next line, this line, from here
// to the matching enable or the end of the file), spelled `oxlint-` or `eslint-`, that names
// `no-restricted-properties` or names no rule, and that covers a line holding the identifier
// `Reflect` or a `["Reflect"]` member. A comment, a string or another object's member is no use of
// `Reflect`, so it does not count.
//
// What it allows: `allow`, a file's path from the top of the repo and how many such comments it
// may hold, set once in `.oxlintrc.json`. The plan names 6 lines in 3 files, a `has` and a `get`
// in each hostile Proxy. Every comment past a file's count is refused, and so is every one in a
// file the list does not name.
//
// Where it reports, and why there: at the very start of the file, with the comment's line in the
// message, as `no-bare-disable` does. A comment that also named this rule would silence a report
// on its own line.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { pathIn } from "./match.ts";

const START = { line: 1, column: 0 };
const RULE = "no-restricted-properties";
// The keyword, its form, and the rest up to the reason.
const DIRECTIVE = /^\s*(?:oxlint|eslint)-(disable|enable)(-next-line|-line)?(?:\s+([^]*?))?\s*(?:--[^]*)?$/;

/** The counts `allow` gives, by file, or an empty map for options this rule cannot read. */
const allowIn = (options: ReadonlyArray<unknown>): ReadonlyMap<string, number> => {
  const [given] = options;

  if (typeof given !== "object" || given === null || !("allow" in given)) {
    return new Map();
  }

  const { allow } = given;

  if (typeof allow !== "object" || allow === null) {
    return new Map();
  }

  return new Map(
    Object.entries(allow).flatMap(([file, count]): Array<[string, number]> =>
      typeof count === "number" ? [[file, count]] : [],
    ),
  );
};

/** Whether a directive's rule list reaches this rule: it names it, with or without `eslint/`, or names none. */
const reaches = (names: string | undefined): boolean => {
  const listed = (names ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return listed.length === 0 || listed.some((name) => name === RULE || name === `eslint/${RULE}`);
};

/** One directive comment: its form, and the lines it starts and ends on. */
interface Directive {
  readonly keyword: "disable" | "enable";
  readonly form: "" | "-next-line" | "-line";
  readonly start: number;
  readonly end: number;
}

export const reflectDisables: CreateRule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { allow: { type: "object", additionalProperties: { type: "integer", minimum: 0 } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowed = allowIn(context.options).get(pathIn(context)) ?? 0;
    // The lines that name Reflect in code.
    const named = new Set<number>();
    const mark = (node: ESTree.Node) => {
      named.add(node.loc.start.line);
    };

    return {
      Identifier(node) {
        if (node.name === "Reflect") {
          mark(node);
        }
      },
      MemberExpression(node) {
        if (node.computed && node.property.type === "Literal" && node.property.value === "Reflect") {
          mark(node.property);
        }
      },
      "Program:exit"() {
        const source = context.sourceCode;
        const lastLine = source.getLocFromIndex(source.text.length).line;
        const directives: Directive[] = [];

        for (const comment of source.getAllComments()) {
          const found = DIRECTIVE.exec(comment.value);

          if (found === null || !reaches(found[3])) {
            continue;
          }

          directives.push({
            keyword: found[1] === "enable" ? "enable" : "disable",
            form: found[2] === "-next-line" ? "-next-line" : found[2] === "-line" ? "-line" : "",
            start: source.getLocFromIndex(comment.range[0]).line,
            end: source.getLocFromIndex(comment.range[1]).line,
          });
        }

        const covers = (from: number, to: number) => {
          for (let line = from; line <= to; line++) {
            if (named.has(line)) {
              return true;
            }
          }

          return false;
        };
        let used = 0;

        for (const [i, directive] of directives.entries()) {
          if (directive.keyword === "enable") {
            continue;
          }

          const block = () => {
            const until = directives.slice(i + 1).find((d) => d.keyword === "enable" && d.form === "");
            return covers(directive.start, until === undefined ? lastLine : until.start);
          };
          const reflect =
            directive.form === "-next-line"
              ? covers(directive.end + 1, directive.end + 1)
              : directive.form === "-line"
                ? covers(directive.start, directive.end)
                : block();

          if (!reflect) {
            continue;
          }

          used++;

          if (used > allowed) {
            context.report({
              loc: { start: START, end: START },
              message: `The ignore comment on line ${directive.start} lets a Reflect call through no-restricted-properties, and this file may hold ${allowed} (0554). Decode with Schema, narrow with Predicate.hasProperty, or assign through the type.`,
            });
          }
        }
      },
    };
  },
};
