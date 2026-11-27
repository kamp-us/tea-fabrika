// ReviewGit.layer: the git questions the review record asks (the ancestor, merge base and patch id of two commits, and the commits a
// branch adds to main), through `@kalfa/git`'s process adapter on one checkout's `.git`. The adapter pins git's config and environment, so
// the ids this laptop writes equal the ids a CI runner computes for the same commits. Its limits are constants: lead tooling has no
// settings file, and a call over a limit fails and never cuts.
import * as ProcessRepository from "@kalfa/git/process";
import * as Settings from "@kalfa/git/Settings";
import { Schema } from "effect";

const SETTINGS = Schema.decodeSync(Settings.Settings)({
  // Files is 3000 to match GitHub's own cut for a pull request; the rest is generous.
  limits: {
    commits: 5000,
    refs: 5000,
    bytes: 1_000_000,
    files: 3000,
    diff: 100_000_000,
    blob: 10_000_000,
    time: "60 seconds",
    kill: "5 seconds",
  },
  // The record writes no commit, so this name is never used; the adapter needs one.
  committer: { name: "review record", email: "review@example.invalid" },
});

/** The `Repository` of the checkout `dir`, which holds a `.git` folder. */
export const layer = (dir: string) => ProcessRepository.layer({ path: `${dir}/.git`, settings: SETTINGS });
