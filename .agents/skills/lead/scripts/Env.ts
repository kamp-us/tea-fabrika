// Env: the values env.sh gives the lead's scripts, for the TypeScript ones (S6 of
// docs/plan/quests/port-scripts-0113-PLAN.md). Today's lead tooling, run on our own laptop; it is
// not product. env.sh stays, sourced by box.sh, until S14 ports box.sh and deletes it.
//
//   MAIN              the main checkout: the folder that holds git's common dir, so a worktree
//                     finds its main checkout
//   BOXES             where the boxes and saved plans live: `boxes` beside MAIN
//   REMOTE            origin's URL, or "" when there is no origin
//   GH_REPO           owner/name on GitHub, read from REMOTE
//   FABRIKA_COAUTHOR  `user.name <user.email>` from the person's global git config
//   CODEX_MODEL       the model a box runs, and CODEX_EFFORT its effort: settings (0069) a person
//   CODEX_EFFORT      sets in MAIN/.agents/skills/lead/local.env, which git ignores
//
// Each value set from outside and not empty wins, as env.sh's `${X:-...}`, and over local.env too
// (the plan's rule, where env.sh's sourced local.env overwrites it). What is not set from outside
// is asked only then: of `Git`, and of local.env through `FileSystem`. No process of its own.
import { NodeServices } from "@effect/platform-node";
import { Config, Context, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Git } from "./git/Git.ts";
import * as GitProcess from "./git/GitProcess.ts";

export type Values = {
  readonly MAIN: string;
  readonly BOXES: string;
  readonly REMOTE: string;
  readonly GH_REPO: string;
  readonly FABRIKA_COAUTHOR: string;
  readonly CODEX_MODEL: string;
  readonly CODEX_EFFORT: string;
};

export class Env extends Context.Service<Env, Values>()("lead/Env") {}

/** Where local.env sits under the main checkout. */
const LOCAL = [".agents", "skills", "lead", "local.env"] as const;

/** What a box runs when nothing sets the model or its effort: env.sh's defaults. */
const DEFAULTS = { CODEX_MODEL: "gpt-6.1-sol", CODEX_EFFORT: "high" } as const;

/** The value set from outside, else what `found` gives; `found` runs only when nothing is set. */
const orElse = <E, R>(key: keyof Values, found: Effect.Effect<string, E, R>) =>
  Effect.flatMap(Config.option(Config.String(key)), (set) =>
    Option.match(
      Option.filter(set, (value) => value !== ""),
      { onSome: Effect.succeed, onNone: () => found },
    ),
  );

/** A value without one matching pair of quotes around it, as the shell drops them. */
const unquote = (value: string) => value.replace(/^"(.*)"$|^'(.*)'$/, (_, a = "", b = "") => `${a}${b}`);

/**
 * The value local.env's last assignment of `key` gives, as sourcing it leaves it; none when no line
 * assigns it or the last one assigns nothing. A comment is no assignment.
 */
const assigned = (text: string, key: string): Option.Option<string> =>
  Option.fromNullishOr(
    text
      .split("\n")
      .filter((line) => line.startsWith(`${key}=`))
      .at(-1),
  ).pipe(
    Option.map((line) => unquote(line.slice(key.length + 1))),
    Option.filter((value) => value !== ""),
  );

/** On `Git`, `FileSystem` and `Path`; fails when nothing sets MAIN and git cannot name one. */
export const layer = Layer.effect(
  Env,
  Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const MAIN = yield* orElse(
      "MAIN",
      Effect.map(git.commonDir, (dir) => path.dirname(dir)),
    );
    const REMOTE = yield* orElse(
      "REMOTE",
      Effect.map(
        git.remote("origin"),
        Option.getOrElse(() => ""),
      ),
    );
    const coauthor = Effect.gen(function* () {
      const name = Option.getOrElse(yield* git.globalConfig("user.name"), () => "");
      const email = Option.getOrElse(yield* git.globalConfig("user.email"), () => "");
      return `${name} <${email}>`;
    });
    const file = path.join(MAIN, ...LOCAL);
    const local = Effect.gen(function* () {
      return (yield* fs.exists(file)) ? yield* fs.readFileString(file) : "";
    });
    const setting = (key: keyof typeof DEFAULTS) =>
      orElse(
        key,
        Effect.map(local, (text) => Option.getOrElse(assigned(text, key), () => DEFAULTS[key])),
      );

    return Env.of({
      MAIN,
      BOXES: yield* orElse(
        "BOXES",
        Effect.sync(() => path.join(path.dirname(MAIN), "boxes")),
      ),
      REMOTE,
      GH_REPO: yield* orElse(
        "GH_REPO",
        Effect.sync(() => REMOTE.replace(/^(https:\/\/github\.com\/|git@github\.com:)/, "").replace(/\.git$/, "")),
      ),
      FABRIKA_COAUTHOR: yield* orElse("FABRIKA_COAUTHOR", coauthor),
      CODEX_MODEL: yield* setting("CODEX_MODEL"),
      CODEX_EFFORT: yield* setting("CODEX_EFFORT"),
    });
  }),
);

/** The fixed record it is given. */
export const layerTest = (values: Values): Layer.Layer<Env> => Layer.succeed(Env, Env.of(values));

/**
 * The values on this machine: from the process environment, real git run from this folder (env.sh
 * runs it from its own, the same folder) and Node's file system.
 */
export const read = Effect.service(Env).pipe(
  Effect.provide(layer.pipe(Layer.provide(GitProcess.layer(import.meta.dirname)), Layer.provide(NodeServices.layer))),
);
