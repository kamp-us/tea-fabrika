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
