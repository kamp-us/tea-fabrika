// Sections: whether a pull request's description is a real one, written by the pr skill, and not the
// placeholder a draft opens with. The pr skill's template has three sections, `## Summary`,
// `## Evidence` and `## Merge Danger`, and a description missing one is refused with its name.
// Queue.body reads it before the queue is asked (so `land.ts check` and `land.ts queue` agree), and
// Publish writes the placeholder it refuses, so the writer and the check share one sentence. Pure.
// Today's lead tooling, run on our own laptop. Read through its module: `Sections.refusal(...)`.
import { Array as Arr, Option, String as Str, pipe } from "effect";

/** What a draft says when a commit opens it; the quest's ready step gives it the brief's words. */
export const DRAFT_BODY =
  "Opened as a draft at this branch's first commit, so no code stays only on a branch (every commit " +
  "is pushed when it is made). It is marked ready when its steps have passed.";

/** The sections the pr skill's template requires, as its headings are spelled. */
export const REQUIRED: ReadonlyArray<string> = ["Summary", "Evidence", "Merge Danger"];

const squash = (text: string): string => pipe(text, Str.replaceAll("\r", ""), Str.split(/\s+/), Arr.join(" "));

/** Whether `text` holds the draft placeholder, however its lines are wrapped. */
const placeholder = (text: string): boolean => squash(text).includes(squash(DRAFT_BODY));

/** Whether `body` has a heading of level two or three that reads `name`, in any case (a quest brief writes `### Summary`). */
const has = (body: string, name: string): boolean =>
  pipe(body, Str.replaceAll("\r", ""), Str.split("\n"), Arr.some(heading(name)));

const heading = (name: string) => {
  const pattern = new RegExp(`^#{2,3}\\s+${name.replaceAll(" ", "\\s+")}\\s*$`, "i");

  return (line: string): boolean => pattern.test(Str.trim(line));
};

/** The required sections `body` has no heading for, in the skill's order. */
export const missing = (body: string): ReadonlyArray<string> => Arr.filter(REQUIRED, (name) => !has(body, name));

const SKILL = "the pr skill, .agents/skills/pr/SKILL.md";

/**
 * Why a description may not merge as it stands, or `null` when it may: it still holds the draft
 * placeholder, or it lacks a section the pr skill requires. Names each thing and points at the skill.
 */
export const refusal = (body: string): string | null => {
  const left = Option.liftPredicate(body, placeholder);
  const absent = missing(body);

  const reasons = [
    ...Option.match(left, {
      onNone: () => [],
      onSome: () => ["its description is still the draft placeholder sentence"],
    }),
    ...(absent.length === 0
      ? []
      : [
          `its description lacks the sections the pr skill requires: ${Arr.join(
            Arr.map(absent, (name) => `## ${name}`),
            ", ",
          )}`,
        ]),
  ];

  return reasons.length === 0 ? null : `${Arr.join(reasons, "; ")}; write the body with ${SKILL}`;
};
