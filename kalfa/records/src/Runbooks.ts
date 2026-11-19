/**
 * The runbook check: every tracked `.kalfa/runbooks/*.md` keeps a `summary` in its frontmatter.
 * A sev runbook, `.kalfa/runbooks/sev-*.md`, also has the five level-two headings Trigger, Roles, Steps, Exit and
 * Comms, and the sev skill, `.agents/skills/sev/SKILL.md`, links every sev runbook and no sev runbook that
 * is not there.
 */
import { Effect, Path, Predicate, Result } from "effect";
import { Finding, type RunbookRule } from "./Finding.ts";
import { parse } from "./Frontmatter.ts";
import { markdown } from "./Markdown.ts";
import { read, Tracked } from "./Tracked.ts";

const RUNBOOK = /^\.kalfa\/runbooks\/[^/]+\.md$/;

const SEV = /^\.kalfa\/runbooks\/sev-[^/]+\.md$/;

const SKILL = ".agents/skills/sev/SKILL.md";

/** The parts every sev runbook has, as level-two headings. */
const HEADINGS = ["Trigger", "Roles", "Steps", "Exit", "Comms"] as const;

const found = (path: string, line: number, rule: typeof RunbookRule.Type, raw = "") =>
  Finding.cases.runbook.make({ path, line, rule, raw });

/** The first line after a frontmatter block, counted from 0: where the prose begins. */
const body = (text: string) => {
  const lines = text.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;

  return end < 0 ? 0 : end + 1;
};

/** Where a link points, as a repo path: no `#anchor`, and `""` for anything that is not a path in this repo. */
const target = (path: Path.Path, from: string, written: string) => {
  const file = written.split(/[#?]/, 1)[0] ?? "";

  return file === "" || /^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith("/")
    ? ""
    : path.normalize(path.join(path.dirname(from), file));
};

/**
 * The `runbook` findings of the whole repo.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const tracked = yield* Tracked;
  const files = (yield* tracked.files).filter((entry) => !entry.symlink).map((entry) => entry.path);
  const runbooks = files.filter((file) => RUNBOOK.test(file));

  const pages = yield* read(root, [...runbooks, ...files.filter((file) => file === SKILL)]);

  const shape = pages
    .filter(({ path: file }) => RUNBOOK.test(file))
    .flatMap(({ path: file, text }) => {
      const parsed = parse(text);
      const values = Result.isSuccess(parsed) ? parsed.success.values : undefined;
      const at = (key: string) => (Result.isSuccess(parsed) ? (parsed.success.lines.get(key) ?? 1) : 1);
      const written = (key: string) => (Predicate.hasProperty(values, key) ? values[key] : undefined);
      const summary = written("summary");

      const rules = [
        ...(Predicate.isString(summary) && summary.trim() !== "" ? [] : [found(file, at("summary"), "summary")]),
      ];

      if (!SEV.test(file)) {
        return rules;
      }

      const levelTwo = new Set(
        markdown(text, body(text))
          .blocks.filter((block) => block.heading === 2)
          .map((block) => block.text.trim()),
      );

      return [
        ...rules,
        ...HEADINGS.filter((name) => !levelTwo.has(name)).map((name) => found(file, 1, "heading", name)),
      ];
    });

  // What the sev skill links: each `.kalfa/runbooks/sev-*.md` it points at, and where.
  const skill = pages.find(({ path: file }) => file === SKILL);
  const linked = new Set<string>();
  const dangling: Array<Finding> = [];

  for (const { url, line } of skill === undefined ? [] : markdown(skill.text).links) {
    const there = target(path, SKILL, url);

    if (SEV.test(there)) {
      linked.add(there);

      if (!files.includes(there)) {
        dangling.push(found(SKILL, line, "dangling", there));
      }
    }
  }

  const unlinked = runbooks
    .filter((file) => SEV.test(file) && !linked.has(file))
    .map((file) => found(file, 1, "unlinked"));

  return [...shape, ...unlinked, ...dangling];
});
