// The id of one agent run in a quest, read through its module as `RunId.next(...)`.
// Today's lead tooling, run on our own laptop; it is not product.
//
// A run id is quest + step + n: `p39s1-tests2` is quest `p39s1`, step `tests`, the 2nd run of that
// step in this quest. The id names the run's box and every file it leaves in the boxes folder, and
// it is the `run` of the run's field row and state entry. Drive's steps, the chain's judgment and
// its host step all take their id here, so no two callers count apart.
//
//   RunId.next("p39s1", "tests", ["p39s1-tests1.md", "p39s1-tests2-prompt.md"])  // "p39s1-tests3"
//   RunId.parse("p39s1-tests3")  // { quest: "p39s1", step: "tests", n: 3 }
//
// n is one past the highest n any existing name holds for that quest and step, never a gap below
// it: a restarted quest never takes the name of a box or a log that is still there (p39s1,
// 2026-11-11: two launches both counted the state file's entries and both took `p39s1-tests2`).

import { String as Str, pipe } from "effect";

/** One run id's parts. */
export interface Parts {
  readonly quest: string;
  readonly step: string;
  readonly n: number;
}

/** A quest name, as drive and the chain accept it; a step is one lowercase word; n has no leading 0. */
const ID = /^([a-z0-9][a-z0-9-]*)-([a-z]+)([1-9][0-9]*)$/;

/**
 * Every file one run keeps in the boxes folder, by suffix after its id: its box and the box's git
 * data, its prompt, report, events and logs. Longest first, so `-plan.md` is read before `.md`.
 */
export const FILES = [
  "-plan.jsonl",
  "-prompt.md",
  "-gitdata",
  "-plan.md",
  "-mutbox",
  ".jsonl",
  "-view",
  ".err",
  ".log",
  ".md",
  "",
] as const;

/** The id of a run's parts. */
export const make = (parts: Parts): string => `${parts.quest}-${parts.step}${parts.n}`;

/** A run id's parts, or `null` when the text is no run id. */
export const parse = (id: string): Parts | null => {
  const m = ID.exec(id);

  return m === null ? null : { quest: m[1] ?? "", step: m[2] ?? "", n: Number(m[3]) };
};

/** The run a file in the boxes folder belongs to, or `null` when it is no run's file. */
export const owner = (name: string): Parts | null => {
  for (const suffix of FILES) {
    if (pipe(name, Str.endsWith(suffix))) {
      const parts = parse(pipe(name, Str.slice(0, name.length - suffix.length)));

      if (parts !== null) {
        return parts;
      }
    }
  }

  return null;
};

/**
 * The next run id for this quest and step: one past the highest n that any of `names` holds, where
 * a name is a file in the boxes folder or an id the quest's state file already records.
 */
export const next = (quest: string, step: string, names: Iterable<string>): string => {
  let most = 0;

  for (const name of names) {
    const parts = owner(name);

    if (parts !== null && parts.quest === quest && parts.step === step) {
      most = Math.max(most, parts.n);
    }
  }

  return make({ quest, step, n: most + 1 });
};
