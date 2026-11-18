/**
 * The patch check (decision 0605): no record patches another. A decision says what holds now, in its
 * own text, so it has no `## Amendments` section, no line that says the rest of an older record still
 * holds, and no line that says a rule is carried forward. Fenced and inline code are not read, since
 * 0605 and its neighbors quote the forms they forbid.
 */
import { Effect } from "effect";
import { Finding } from "./Finding.ts";
import { decisions } from "./Frontmatter.ts";
import { prose } from "./Prose.ts";

const FORMS = [
  { form: "amendments", pattern: /^## Amendments\s*$/ },
  { form: "still-holds", pattern: /\b(the )?rest\b[^.]{0,60}\b(still )?holds\b/i },
  { form: "carried-forward", pattern: /\bcarried forward\b/i },
] as const;

/**
 * Every decision's `patch` findings: the heading, the still-holds line and the carried-forward line, each with its line in the file.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const all = yield* decisions(root);

  return all.flatMap(({ path, text }) => {
    const lines = text.split("\n");
    const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;

    return prose(text, end + 1).flatMap(({ line, text: each }) =>
      FORMS.filter(({ pattern }) => pattern.test(each)).map(({ form }) =>
        Finding.cases.patch.make({ path, line, form }),
      ),
    );
  });
});
