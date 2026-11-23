// Ticket 1846, kalfa/config (new work), slice 1: W2 of the approved plan (.kalfa/quests/kalfa-config-command-PLAN.md), the
// plan's finding 2. For a group with a live setting, a file that sets the quiet window, `config.watch.debounce`, is a
// good file: `SettingGroup.edit` takes it, and so must the disk calls `SettingGroup.set` and `SettingGroup.remove`, which
// today pass the group without its window to the check and fail `unknown` at that key. Written before the fix.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, Exit, Match } from "effect";
import { SettingGroup } from "./index.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import {
  makeGroup,
  number,
  pick,
  Reach,
  type Spec,
  specsA,
  TextDraw,
  validValue,
  WINDOWS_VALID,
} from "./SettingGroup.text.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const ROOT = "/work";

const HOME = "/people/one";

type Repo = "repo" | "none" | "empty";

type Call = `${"set" | "remove"}-${"repo" | "user"}-${Repo}`;

const OPTIONS: ReadonlyArray<Repo> = ["repo", "none", "empty"];

const CALLS: ReadonlyArray<Call> = OPTIONS.flatMap((option) => [
  `set-repo-${option}` as const,
  `set-user-${option}` as const,
  `remove-repo-${option}` as const,
  `remove-user-${option}` as const,
]);

/** A file as a person writes it: the window set, and one setting set below it. */
const seeded = (spec: Spec, window: string, value: unknown) => {
  const [table = "", key = ""] = spec.name.split(".");

  return `[config.watch]\ndebounce = ${JSON.stringify(window)}\n\n[${table}]\n${key} = ${JSON.stringify(value)}\n`;
};

// Plants: (z) pass the group without `watched` to the disk calls, as today: every call fails `unknown` at the window's key,
// red; (r) read the repo folder as `options.repo`, with no `?.`: a call with no option throws, red; (r) read it as `"x"` when
// none is given: the file is not found, red.
it.effect.prop(
  "W2 the disk calls check the quiet window: for a group with a live setting and a file that sets the window, a disk set and a disk remove succeed as `edit` does and write the text `edit` answers",
  { draw: TextDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Call>(CALLS);
      const specs = specsA(draw);
      const group = makeGroup(draw.app, specs);
      const [repoSpec, userSpec] = specs;

      if (repoSpec === undefined || userSpec === undefined) {
        return;
      }

      const window = WINDOWS_VALID[pick(draw, 8) % WINDOWS_VALID.length] ?? "100 millis";

      const texts = {
        repo: seeded(repoSpec, window, number(draw, 0)),
        user: seeded(userSpec, window, "people"),
      };

      const targets = { repo: repoSpec, user: userSpec } as const;
      const user = `${HOME}/.${draw.app}/${draw.app}.toml`;

      // The repo file is under the folder the call is given, or under the current one, which the in-memory disk roots.
      const repoAt = (repo: Repo) => `${repo === "repo" ? ROOT : ""}/.${draw.app}/${draw.app}.toml`;

      const given = (repo: Repo): { readonly repo?: string } | undefined =>
        Match.value(repo).pipe(
          Match.when("repo", () => ({ repo: ROOT })),
          Match.when("empty", () => ({})),
          Match.orElse(() => undefined),
        );

      for (const repo of OPTIONS) {
        for (const file of ["repo", "user"] as const) {
          const spec = targets[file];
          const setting = group.settings.find((one) => one.name === spec.name);
          const next = validValue(draw, spec, 1);

          expect(setting, `${spec.name} is in the group`).toBeDefined();

          if (setting === undefined) {
            continue;
          }

          for (const call of ["set", "remove"] as const) {
            const disk = MemoryFiles.writable({
              files: { [repoAt(repo)]: texts.repo, [user]: texts.user },
              folders: [`${repo === "repo" ? ROOT : ""}/.${draw.app}`, `${HOME}/.${draw.app}`],
            });

            const editing = SettingGroup.edit(group, texts[file], file);
            const wanted = yield* Effect.exit(call === "set" ? editing.set(setting, next) : editing.remove(setting));

            // `edit` is the oracle: it takes the file, so a disk call on the same file takes it too.
            expect(Exit.isSuccess(wanted), `${call} ${file}: edit takes the file`).toBe(true);

            const options = given(repo);

            const exit = yield* Effect.exit(
              (call === "set"
                ? SettingGroup.set(group, setting, next, file, options)
                : SettingGroup.remove(group, setting, file, options)
              ).pipe(
                Effect.provide(disk.layer),
                Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME } }))),
              ),
            );

            expect(Exit.isSuccess(exit), `${call} ${file} with repo ${repo}: the disk call takes the file`).toBe(true);

            const left = (yield* disk.files)[file === "repo" ? repoAt(repo) : user];

            expect(left, `${call} ${file} with repo ${repo}: the file holds what edit answers`).toBe(
              Exit.isSuccess(wanted) ? wanted.value : undefined,
            );
            reach.mark(`${call}-${file}-${repo}`);
          }
        }
      }

      reach.done();
    }),
  check,
);
