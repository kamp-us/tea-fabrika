// worktree.ts: make one linked worktree for a branch, ready to work in: beside the main checkout as
// `../tf-<name>`, on a new branch cut from origin/main, with the branch's upstream set to its own
// `origin/<branch>` (never to origin/main) and the packages installed. Today's lead tooling, run on
// our own laptop; it is not product.
//
//   node .agents/skills/lead/scripts/worktree.ts <name> <branch>
//                               run in any checkout of the repo; one line on stdout, exit 0 made, 1 refused, 2 usage
//
// Why both: a `git worktree add -b <branch> <dir> origin/main` makes the branch track origin/main, so a
// helper's `git pull` pulls main in ("divergent branches"), and the new folder has no packages, so a
// commit step's checks fail. Here the branch tracks `origin/<branch>`, which does not exist until the
// first push (the commit step's publish.ts makes it); `git pull` then pulls only the branch's own work.
// The install is `pnpm install --frozen-lockfile --prefer-offline` under `nice -n 15`: no lockfile change.
//
// It refuses a folder or a branch that already exists, and never removes anything. `<name>` is
// lower-case words joined by dashes; `<branch>` is a plain branch name, `fabrikalfa/<name>` for the bot's.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { run } from "./pr/command.ts";

/** What was asked: the worktree's short name and its branch. */
export type Words = { readonly name: string; readonly branch: string };

/** Reads `<name> <branch>`, or `null` for anything else: a name or a branch of the wrong shape, or a wrong count. */
export const words = (args: ReadonlyArray<string>): Words | null => {
  const [name, branch, ...more] = args;

  return more.length === 0 &&
    name !== undefined &&
    branch !== undefined &&
    /^[a-z0-9][a-z0-9-]*$/.test(name) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !branch.includes("..") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock")
    ? { name, branch }
    : null;
};

/** One command to run: the program, its arguments and the folder it starts in. */
export type Step = { readonly cmd: string; readonly args: ReadonlyArray<string>; readonly cwd: string };

/**
 * The git steps that make the worktree at `dir` from the checkout at `main`: fetch main, add the worktree on a
 * new branch from origin/main with no tracking, then name `origin/<branch>` as the branch's upstream.
 */
export const gitSteps = (main: string, dir: string, w: Words): ReadonlyArray<Step> => [
  { cmd: "git", args: ["fetch", "-q", "origin", "main"], cwd: main },
  { cmd: "git", args: ["worktree", "add", "-q", "--no-track", "-b", w.branch, dir, "origin/main"], cwd: main },
  { cmd: "git", args: ["config", `branch.${w.branch}.remote`, "origin"], cwd: dir },
  { cmd: "git", args: ["config", `branch.${w.branch}.merge`, `refs/heads/${w.branch}`], cwd: dir },
];

/** The install that gives the new folder its own packages, from the warm store. */
export const installStep = (dir: string): Step => ({
  cmd: "nice",
  args: ["-n", "15", "pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
  cwd: dir,
});

/** The folder for a name: beside the main checkout, `../tf-<name>`. */
export const folder = (main: string, name: string): string =>
  `${main.replace(/\/+$/, "").replace(/[^/]*$/, "")}tf-${name}`;

const main = Effect.fn("worktree.main")(function* (w: Words) {
  const here = process.cwd();
  const common = (yield* run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], here)).out.trim();
  const checkout = common.replace(/\/\.git\/?$/, "");
  const dir = folder(checkout, w.name);

  const refuse = (reason: string) =>
    Effect.andThen(
      Console.log(`worktree: refused: ${reason}`),
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    );

  if (!common.endsWith("/.git") || checkout === "") {
    return yield* refuse("not inside a normal checkout of the repo");
  }

  for (const step of [...gitSteps(checkout, dir, w), installStep(dir)]) {
    const ran = yield* run(step.cmd, step.args, step.cwd);

    if (ran.code !== 0) {
      const said = `${ran.out}\n${ran.err}`.trim().split("\n").at(-1) ?? "";

      return yield* refuse(`\`${step.cmd} ${step.args.join(" ")}\` exited ${ran.code}: ${said}`);
    }
  }

  yield* Console.log(`worktree: ${dir} is on ${w.branch}, tracking origin/${w.branch}, packages installed`);
});

if (import.meta.main) {
  const asked = words(process.argv.slice(2));

  const program =
    asked === null
      ? Effect.andThen(
          Console.error("usage: worktree.ts <name> <branch>   (name: lower-case words with dashes)"),
          Effect.sync(() => {
            process.exitCode = 2;
          }),
        )
      : main(asked);

  NodeRuntime.runMain(
    program.pipe(
      Effect.catchTag("PlatformError", (e) =>
        Effect.andThen(
          Console.log(`worktree: refused: a command could not run: ${e.message}`),
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
