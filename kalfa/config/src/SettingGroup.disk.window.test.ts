// Ticket 1846, kalfa/config (new work), slice 1: W2 of the approved plan (.kalfa/quests/kalfa-config-command-PLAN.md), the
// plan's finding 2. For a group with a live setting, a file that sets the quiet window, `config.watch.debounce`, is a
// good file: `SettingGroup.edit` takes it, and so must the disk calls `SettingGroup.set` and `SettingGroup.remove`, which
// today pass the group without its window to the check and fail `unknown` at that key. Written before the fix.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ConfigProvider, Effect, Exit } from "effect";
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

type Call = "set-repo" | "set-user" | "remove-repo" | "remove-user";

const CALLS: ReadonlyArray<Call> = ["set-repo", "set-user", "remove-repo", "remove-user"];

/** A file as a person writes it: the window set, and one setting set below it. */
const seeded = (spec: Spec, window: string, value: unknown) => {
  const [table = "", key = ""] = spec.name.split(".");

  return `[config.watch]\ndebounce = ${JSON.stringify(window)}\n\n[${table}]\n${key} = ${JSON.stringify(value)}\n`;
};

// Plants: (z) pass the group without `watched` to the disk calls, as today: every call fails `unknown` at the window's key,
// red.
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

      const places = {
        repo: `${ROOT}/.${draw.app}/${draw.app}.toml`,
        user: `${HOME}/.${draw.app}/${draw.app}.toml`,
      };

      const texts = {
        repo: seeded(repoSpec, window, number(draw, 0)),
        user: seeded(userSpec, window, "people"),
      };

      const targets = { repo: repoSpec, user: userSpec } as const;

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
            files: { [places.repo]: texts.repo, [places.user]: texts.user },
            folders: [`${ROOT}/.${draw.app}`, `${HOME}/.${draw.app}`],
          });

          const editing = SettingGroup.edit(group, texts[file], file);
          const wanted = yield* Effect.exit(call === "set" ? editing.set(setting, next) : editing.remove(setting));

          // `edit` is the oracle: it takes the file, so a disk call on the same file takes it too.
          expect(Exit.isSuccess(wanted), `${call} ${file}: edit takes the file`).toBe(true);

          const exit = yield* Effect.exit(
            (call === "set"
              ? SettingGroup.set(group, setting, next, file, { repo: ROOT })
              : SettingGroup.remove(group, setting, file, { repo: ROOT })
            ).pipe(
              Effect.provide(disk.layer),
              Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME } }))),
            ),
          );

          expect(Exit.isSuccess(exit), `${call} ${file}: the disk call takes the file`).toBe(true);

          const left = (yield* disk.files)[places[file]];

          expect(left, `${call} ${file}: the file holds what edit answers`).toBe(
            Exit.isSuccess(wanted) ? wanted.value : undefined,
          );
          reach.mark(`${call}-${file}`);
        }
      }

      reach.done();
    }),
  check,
);
