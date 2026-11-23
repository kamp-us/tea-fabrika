// Today's tooling, both versions: whether this machine may start a test that drives a real resource
// or a real window. hostFiles also checks plain selected source (0594). Decision 0178's risk is the owner's
// Mac: a host run there once ended every process he owned. So such a test never starts on the
// laptop by accident, and it may start in CI or in a cloud box, which are not his machine.
//
//   where              signal                                          answer
//   CI                 `CI` set, which GitHub's runners do               allow
//   the owner's yes    `FABRIKA_HOST_RUN_OWNER_APPROVED=1`, one command  allow
//   a cloud box        `CLAUDE_CODE_REMOTE=true` on Linux                allow
//   anything else      the laptop, or a box on it                        refuse
//
// The cloud box is read from `CLAUDE_CODE_REMOTE`, which the chat tools' cloud runtime sets to
// `true` and the CLI itself reads with that exact test (experiment 286 lists it among the cloud
// session's variables, and a real box's environment shows it). It is an explicit marker, not a
// guess from the platform. `CLAUDECODE` is no marker, since local sessions set it too, and the box
// has no `/.dockerenv` or `/run/.containerenv` to read. The platform is a second lock: the cloud box
// is a Linux container and the laptop is a Mac, so a stray `CLAUDE_CODE_REMOTE` in a shell on the
// Mac still refuses. The laptop's own boxes (box.ts's sandbox, mutbox's Docker container on the laptop,
// which is handed no `CI`) set no such variable, so they refuse too: they run on the Mac.
//
// The doubt: if the cloud runtime ever stops setting the variable, or sets another value, a cloud
// box is refused again, which is the safe side. Nothing stops a shell from setting `CI` or the
// owner's variable itself: this guards against an accident, not against an agent that means to get
// around it.
import { isAbsolute, relative } from "node:path";
import { Match } from "effect";
import { openers } from "./oxlint-plugins/test-kind.ts";

/** The owner's named yes for one command, after the lead's read (0178). */
export const HOST_RUN = "FABRIKA_HOST_RUN_OWNER_APPROVED";

/** Whether a host-only test may start here, and why. */
type HostRun = { readonly _tag: "allow"; readonly reason: "ci" | "owner" | "box" } | { readonly _tag: "refuse" };

/** The guard's decision, from the environment and the platform alone. */
export const hostRun = (env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): HostRun => {
  if ((env.CI ?? "") !== "") {
    return { _tag: "allow", reason: "ci" };
  }

  if (env[HOST_RUN] === "1") {
    return { _tag: "allow", reason: "owner" };
  }

  if (env.CLAUDE_CODE_REMOTE === "true" && platform === "linux") {
    return { _tag: "allow", reason: "box" };
  }

  return { _tag: "refuse" };
};

/** Selected files the local guard refuses, including plain tests whose own code signals a process. */
export const hostFiles = (
  files: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  source: (path: string) => string,
): readonly string[] => {
  const where = hostRun(env, platform);
  const remote = Match.valueTags(where, {
    allow: ({ reason }) => reason !== "owner",
    refuse: () => false,
  });

  if (remote) {
    return [];
  }

  const refused = Match.valueTags(where, {
    allow: () => false,
    refuse: () => true,
  });

  return [...new Set(files)].filter((path) => {
    if (/\.(?:integration|visual)\.test\.[cm]?[jt]sx?$/.test(path) && refused) {
      return true;
    }

    // 0594 keeps signals, real windows and real instances off the laptop, even under a plain name.
    return openers(path, source(path)).alone.some((open) =>
      Match.valueTags(open, {
        signal: () => true,
        browser: () => true,
        instance: () => true,
        process: () => false,
        port: () => false,
        network: () => false,
        disk: () => false,
      }),
    );
  });
};

/** What a laptop run asked for, for the check below: its filters, and `--changed`'s files when it has one. */
type Broad = {
  readonly filters: readonly string[];
  /** The files `--changed` starts from, or `null` when git could not list them. `undefined` when the run has no `--changed`. */
  readonly changed: readonly string[] | null | undefined;
};

/** Whether a filter names exactly one test file, and so cannot select more by its own words. */
const narrow = (filter: string, cwd: string): boolean => {
  const path = isAbsolute(filter) ? relative(cwd, filter) : filter.replace(/^\.\//, "");

  return !/[*?[\]{}]/.test(path) && /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?(?::[\d-]+)?$/.test(path);
};

const INSTEAD = "Use: pnpm exec vitest run --maxWorkers=1 <test file> ... (one or more test files, each by its path)";

/**
 * The laptop's refusal of a run that may start many tests, with the one rule that fired and what to run
 * instead; `undefined` when the run is narrow. A run is narrow when every filter is one test file, or when
 * `--changed` starts from files that select no more than the tests they reach. `trigger` says which changed
 * files make Vitest select every test (the config's `forceRerunTriggers`).
 */
export const broadRefusal = (run: Broad, cwd: string, trigger: (path: string) => boolean): string | undefined => {
  if (run.filters.length > 0 && run.filters.every((filter) => narrow(filter, cwd))) {
    return undefined;
  }

  if (run.changed === undefined) {
    const wide = run.filters.filter((filter) => !narrow(filter, cwd));

    return wide.length === 0
      ? `Local broad test run refused: no test file was given, so it would run the full suite. ${INSTEAD}`
      : `Local broad test run refused: ${wide.map((filter) => `'${filter}'`).join(", ")} is not one test file (a folder, a pattern or a name without .test.ts selects many). ${INSTEAD}`;
  }

  if (run.changed === null) {
    return `Local broad test run refused: git could not list the files --changed starts from. ${INSTEAD}`;
  }

  const forced = run.changed.filter(trigger);

  return forced.length === 0
    ? undefined
    : `Local broad test run refused: --changed would select every test, because ${forced.slice(0, 5).join(", ")}${forced.length > 5 ? ` and ${forced.length - 5} more` : ""} changed (a lockfile, a tsconfig, a vitest or oxlint config, layer-rules.json or oxlint-plugins/** each select all). ${INSTEAD}; CI runs the rest.`;
};
