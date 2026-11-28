// Ticket 1995, kalfa/config (new work): RF1 to RF6 and RF8 of the approved plan (.kalfa/quests/kalfa-config-refusals-PLAN.md),
// for the two refusals of the root entry (`@kalfa/config`, `SettingGroup`) that said too little: an `invalid` refusal of
// a setting whose schema has no title and no description, and a `read` refusal. The type law RF7 is in
// SettingGroup.types.test.ts, and C12's changed message is in Cli.test.ts. Written before the code. The file is named
// `Cli.refusals` because it runs the `config` command too (RF2, RF3 and RF6), and `layer-rules.json` puts `Cli*.ts` in the
// layer that may import the command's own test support.
//
// What the code does, as these laws hold it to (the plan's "The read says why" and "The invalid names a rule"):
// - An `invalid` message ends with the rule the value broke, read from the declared parts of the schema only: `<name> is
//   not <title or "a valid value">.` and then the description, else `Expected <rule>.`, else `Its schema names no rule.`
//   for a schema with no title. The value, a message a check wrote at run time and a key inside the value are never read.
// - A `read` message ends `could not be read, because <why>.`, `<why>` from the failure's kind and its POSIX code, never
//   from its message, its path or its description. A fault of the environment says the environment did not answer.
// - The error's `cause` is a `Redacted` of the failure under it; every refusal leaves a span, `config.edit` included.
//
// Every law is a property over generated cases (Cli.refusals.test-support.ts): each builds one case for each
// class it lists from the drawn seeds, and fails when a class was not reached. The texts a refusal must say are written
// there from the plan's tables, never from the code under test.
import { expect, it } from "@effect/vitest";
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import { runsFor } from "@kampus/vitest";
import { Cause, ConfigProvider, Effect, Exit, Option, Redacted, Schema } from "effect";
import {
  command,
  denial,
  EnvironmentDraw,
  ENVIRONMENT_SITES,
  type EnvironmentSite,
  edited,
  environmentMessage,
  FAULT_IDS,
  FaultDraw,
  type FaultId,
  failing,
  homeVariable,
  plant,
  fileText,
  placement,
  forms,
  makeGroup,
  MORE_IDS,
  type MoreId,
  moreCases,
  keyLine,
  type Observed,
  onDisk,
  plain,
  printed,
  READ_SITES,
  Reach,
  type ReadSite,
  readAt,
  readMessage,
  RULE_IDS,
  RuleDraw,
  type RuleId,
  refusal,
  refusedValue,
  repoName,
  repoPath,
  ruleCases,
  ruleText,
  settingName,
  SourceDraw,
  siteWords,
  sitePath,
  sourced,
  startOn,
  TABLE_IDS,
  type TableId,
  tableCases,
  variable,
} from "./Cli.refusals.test-support.ts";
import { SettingGroup } from "./index.ts";
import { filePlace } from "./SettingGroup.edit.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

// ---------------------------------------------------------------------------------------------
// RF1, an `invalid` refusal names a rule, for every kind of schema
// ---------------------------------------------------------------------------------------------

// Plants, one at a time on internal/check.ts, each seen red: (a) give `InvalidType` no rule, so it says "Its schema names
// no rule."; (b) read the filter's `title` in place of `expected`; (c) answer Effect's `<filter>` for a check with no
// text; (d) take the `message` annotation of the filter's inner `InvalidValue`: the needle shows; (e) add `Expected R.`
// after a description too; (f) skip the rule when a title is there; (g) put the rule in place of the description; (h)
// answer the first literal's text for `AnyOf`; (i) keep `explain`'s exact-path match, so the member's fault reads
// `unknown` and names its key, or name the `Pointer` path in the rule; (j) read `expected` only from Effect's built-in
// checks; (n) give `MissingKey` no rule.
it.effect.prop(
  "RF1 an `invalid` refusal names a rule, for every kind of schema: each run builds one group per class (a) to (n), writes its value into `.<app>/<app>.toml` at a drawn line and starts it, and each start fails with the one `SettingsError`, reason `invalid`, the file, the line of the setting's own key, and a message that names the rule its schema declares and holds no needle",
  { draw: RuleDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<RuleId>(RULE_IDS);

      for (const one of ruleCases(draw)) {
        const group = makeGroup(draw, [one.setting]);
        const placed = placement(draw, one);

        const observed = yield* startOn(group, {
          files: { [repoPath(draw)]: placed.text },
          env: { HOME: draw.home },
          repo: draw.repo,
        });

        const found = refusal(observed);

        expect(found.reason, `(${one.id}) the reason`).toBe("invalid");
        expect(found.place, `(${one.id}) the place is the repo file at the fault's own line, never 0`).toEqual(
          filePlace("repo", repoName(draw), placed.line),
        );
        expect(found.message, `(${one.id}) the message`).toBe(
          `${repoName(draw)}, line ${placed.line}: ${settingName(draw)} is not ${one.tail}\n  ${draw.app} did not start.`,
        );

        for (const needle of one.needles) {
          expect(found.message, `(${one.id}) no needle ${needle}`).not.toContain(needle);
        }

        reach.mark(one.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF9, the rest of the rules an issue can declare, and a table of settings given a value
// ---------------------------------------------------------------------------------------------

// Added by the build step, in its own commit, after the guard check found lines no law reached (ticket 1995).
// Plants, one at a time on internal/check.ts, each seen red: (o) drop the `OneOf` arm of `rule`; (u) give `UnexpectedKey` no
// rule; (m) say "Its schema names no rule." for a title with no rule; (v) answer the `message` annotation of a top-level
// `InvalidValue`: the needle shows; (t) delete the table-of-settings branch of `explain`: the key reads `unknown`; (t) test whether every setting, not some, is under the key: a group of two settings reads `unknown`; (t2) join the table's words with nothing: the name loses its dot.
it.effect.prop(
  "RF9 the other rules an issue declares are said, and a table of settings given a value says so: each run builds one group per class (o), (u), (m) and (v), and a file that gives a value to a table, and each start fails `invalid` at the key's line with the rule its schema declares, holding no needle",
  { draw: RuleDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<MoreId | TableId>([...MORE_IDS, ...TABLE_IDS]);

      for (const one of moreCases(draw)) {
        const observed = yield* startOn(makeGroup(draw, [one.setting]), {
          files: { [repoPath(draw)]: fileText(draw, one.raw) },
          env: { HOME: draw.home },
          repo: draw.repo,
        });

        const found = refusal(observed);

        expect(found.reason, `(${one.id}) the reason`).toBe("invalid");
        expect(found.place, `(${one.id}) the place is the repo file at the key's line`).toEqual(
          filePlace("repo", repoName(draw), keyLine(draw)),
        );
        expect(found.message, `(${one.id}) the message`).toBe(
          `${repoName(draw)}, line ${keyLine(draw)}: ${settingName(draw)} is not ${one.tail}\n  ${draw.app} did not start.`,
        );

        for (const needle of one.needles) {
          expect(found.message, `(${one.id}) no needle ${needle}`).not.toContain(needle);
        }

        reach.mark(one.id);
      }

      for (const table of tableCases(draw)) {
        const given = refusal(
          yield* startOn(makeGroup(draw, table.settings), {
            files: { [repoPath(draw)]: table.text },
            env: { HOME: draw.home },
            repo: draw.repo,
          }),
        );

        expect(given.reason, `(${table.id}) the reason`).toBe("invalid");
        expect(given.message, `(${table.id}) the message`).toBe(table.message);
        reach.mark(table.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF2, every source passes its issue
// ---------------------------------------------------------------------------------------------

type Source = "file" | "variable" | "flag" | "edit" | "disk" | "command";

const SOURCES: ReadonlyArray<Source> = ["file", "variable", "flag", "edit", "disk", "command"];

// Plants: (r) build the file's refusal with no issue; (v) pass no issue in `resolve`'s `SchemaError` branch; (k) keep
// `Schema.is` in `change.set`, which has no issue; (l) drop the issue in `Cli.ts`'s `mapError`.
it.effect.prop(
  "RF2 every source passes its issue: each run draws class (b) or (j) and refuses the value from the file at the start, the variable and the flag at the start, `SettingGroup.edit(...).set`, `SettingGroup.set` on disk and `config set`, and each message names the rule exactly as its source says it",
  { draw: SourceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Source>(SOURCES);
      const one = sourced(draw);
      const setting = one.setting;
      const group = makeGroup(draw, [setting]);
      const name = settingName(draw);
      const rule = ruleText(draw);
      const present = { [repoPath(draw)]: "# note\n" };
      const env = { HOME: draw.home };
      const wanted = `is not a valid value. Expected ${rule}.`;

      const inFile = refusal(
        yield* startOn(group, {
          files: { [repoPath(draw)]: fileText(draw, one.raw) },
          env,
          repo: draw.repo,
        }),
      );

      expect(inFile.reason, "file: the reason").toBe("invalid");
      expect(inFile.place, "file: the place").toEqual(filePlace("repo", repoName(draw), keyLine(draw)));
      expect(inFile.message, "file").toBe(
        `${repoName(draw)}, line ${keyLine(draw)}: ${name} ${wanted}\n  ${draw.app} did not start.`,
      );
      reach.mark("file");

      const byVariable = refusal(
        yield* startOn(group, { env: { ...env, [variable(draw)]: one.text }, repo: draw.repo }),
      );

      expect(byVariable.reason, "variable: the reason").toBe("invalid");
      expect(byVariable.place, "variable: the place is the variable").toEqual(
        Diagnostic.Place.cases.environment.make({ name: variable(draw) }),
      );
      expect(byVariable.message, "variable").toBe(`${variable(draw)} ${wanted}\n  ${draw.app} did not start.`);
      reach.mark("variable");

      const byFlag = refusal(yield* startOn(group, { env, flags: { [name]: Option.some(one.text) }, repo: draw.repo }));

      expect(byFlag.reason, "flag: the reason").toBe("invalid");
      expect(byFlag.place, "flag: the place is the flag").toEqual(
        Diagnostic.Place.cases.flag.make({ name: `--${name}` }),
      );
      expect(byFlag.message, "flag").toBe(`--${name} ${wanted}\n  ${draw.app} did not start.`);
      reach.mark("flag");

      const unchanged = `${repoName(draw)}: ${name} ${wanted}\n  ${repoName(draw)} was not changed.`;

      const byEdit = refusal(yield* edited(group, setting, "", refusedValue(one)));

      expect(byEdit.reason, "edit: the reason").toBe("invalid");
      expect(byEdit.place, "edit: the repo file, no line").toEqual(filePlace("repo", repoName(draw)));
      expect(byEdit.message, "edit").toBe(unchanged);
      reach.mark("edit");

      const onTheDisk = yield* onDisk(
        group,
        setting,
        { kind: "set", value: refusedValue(one) },
        { files: present, env, repo: draw.repo },
      );

      const bySet = refusal(onTheDisk);

      expect(bySet.reason, "disk: the reason").toBe("invalid");
      expect(bySet.place, "disk: the repo file, no line").toEqual(filePlace("repo", repoName(draw)));
      expect(bySet.message, "disk").toBe(unchanged);
      expect(onTheDisk.files, "disk: the file is as it was").toEqual(present);
      reach.mark("disk");

      const ran = yield* command({ app: draw.app, groups: [group], repo: draw.repo, env, files: present }, [
        "set",
        name,
        one.text,
      ]);

      const byCommand = refusal(ran);

      expect(byCommand.reason, "command: the reason").toBe("invalid");
      expect(byCommand.message, "command").toBe(
        `${repoName(draw)}: ${name} ${wanted}\n  The repo configuration was not changed.`,
      );
      expect(ran.stdout, "command: nothing is printed").toBe("");
      expect(ran.files, "command: no file changed").toEqual(present);
      reach.mark("command");

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF3, a file read says why
// ---------------------------------------------------------------------------------------------

// Plants: (p) word `PermissionDenied` as another tag; (o) word `BadResource` as another tag; (u) say "could not be read."
// with no reason for the other tags; (q) never print the code; (x) drop the `POSIX` test and print any string code: the
// path shows; (y) unanchor the pattern (`/^E[A-Z0-9]+/`) and print the code whole; (w) word `BadArgument` from its
// `description`: the path shows; keep today's text at the disk site alone, and at the command site alone.
it.effect.prop(
  "RF3 a file read says why: each run plants every class (p), (o), (u), (q), (x), (y) and (w), one at a time, at the repo file at the start, the user file at the start under `HOME` and under `$<APP>_HOME`, the repo file under `SettingGroup.set` on disk and under `config list`, and each call fails with the one `SettingsError`, reason `read`, the file a person reads, no line, and the message `could not be read, because` and the reason, with neither folder's path",
  { draw: FaultDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<`${ReadSite}:${FaultId}`>(
        READ_SITES.flatMap((site) => FAULT_IDS.map((id) => `${site}:${id}` as const)),
      );

      for (const site of READ_SITES) {
        for (const id of FAULT_IDS) {
          const fault = plant(id, draw, sitePath(draw, site));
          const found = refusal(yield* readAt(draw, site, fault.error));
          const at = `${site} (${id})`;

          expect(found.reason, `${at}: the reason`).toBe("read");
          expect(found.place, `${at}: the file a read was refused, no line`).toEqual(
            filePlace(site === "home" || site === "app-home" ? "user" : "repo", siteWords(draw, site).file),
          );
          expect(found.message, `${at}: the message`).toBe(readMessage(draw, site, fault.because));

          for (const folder of [draw.home, draw.repo, draw.moved]) {
            expect(found.message, `${at}: no folder ${folder}`).not.toContain(folder);
          }

          reach.mark(`${site}:${id}`);
        }
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF4, an environment read says why
// ---------------------------------------------------------------------------------------------

/** The variable each site could not read: `<APP>_HOME`, `HOME`, or the setting's own variable (the message names the setting for the last two). */
const ENVIRONMENT_NAMES: Readonly<Record<EnvironmentSite, (draw: RuleDraw) => string>> = {
  "app-home": homeVariable,
  home: () => "HOME",
  holder: variable,
  resolve: variable,
};

// Plants: (z) quote the `SourceError`'s message as the reason; treat every `ConfigError` in `resolve` as `invalid`: the
// fourth site reads `invalid`; keep today's text at `lookup` alone; keep today's text at `holder` alone.
it.effect.prop(
  "RF4 an environment read says why: each run plants a `SourceError` where `<APP>_HOME` is read, where `HOME` is read, where the setting's variable is asked for and where its value is read, and each start fails with the one `SettingsError`, reason `read`, no file, no line, and the message `could not be read, because the environment did not answer.` naming the variable or the setting",
  { draw: EnvironmentDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<EnvironmentSite>(ENVIRONMENT_SITES);

      for (const site of ENVIRONMENT_SITES) {
        const error = new ConfigProvider.SourceError({ message: draw.message });

        const observed = yield* startOn(makeGroup(draw, [plain(draw)]), {
          provider: failing(draw, site, error),
          repo: draw.repo,
        });

        const found = refusal(observed);

        expect(found.reason, `${site}: the reason`).toBe("read");
        expect(found.place, `${site}: the variable the environment did not answer for`).toEqual(
          Diagnostic.Place.cases.environment.make({ name: ENVIRONMENT_NAMES[site](draw) }),
        );
        expect(found.message, `${site}: the message`).toBe(environmentMessage(draw, site));

        for (const text of printed(observed)) {
          for (const form of forms(draw.message)) {
            expect(text, `${site}: the provider's message is in no rendering`).not.toContain(form);
          }
        }

        reach.mark(site);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF5 [secrets], nothing private in any rendering, and the cause is kept hidden
// ---------------------------------------------------------------------------------------------

/** No needle in any text a run can print. */
const clear = (label: string, observed: Observed, needles: ReadonlyArray<string>) => {
  for (const text of printed(observed)) {
    for (const needle of needles) {
      for (const form of forms(needle)) {
        expect(text, `${label}: no ${form}`).not.toContain(form);
      }
    }
  }
};

/** The refusal's cause is a `Redacted` of the very failure the stand-in planted. */
const hidden = (label: string, observed: Observed, planted: unknown) => {
  const { error } = refusal(observed);
  const cause: unknown = error.cause;

  if (!Redacted.isRedacted(cause)) {
    return expect.fail(`${label}: the cause is not Redacted`);
  }

  expect(Redacted.value(cause), `${label}: the cause is the planted failure`).toBe(planted);
};

/** The flows of RF1 whose value or key is a secret: a value of the wrong type, a message that quotes it, and a record's member. */
const SECRET_FLOWS: ReadonlyArray<RuleId> = ["a", "d", "i", "i2", "i3", "w"];

// Plants: (x) keep the cause raw (`Schema.optional(Schema.Defect())` and no `Redacted.make` in `stop`): the
// `PlatformError`'s message prints the path in `Cause.pretty`; (z) keep the cause raw: the `SourceError`'s message shows;
// hide an empty cause (`Redacted.make(undefined)`): the identity fails; (d) as in RF1.
it.effect.prop(
  "RF5 [secrets] nothing private in any rendering, and the cause is kept hidden: for the flows of RF1's (a), (d), (i), (i2), (i3) and (w), of RF3's every class at the start and the disk set, and of RF4's every site, no needle appears raw, JSON-escaped or URL-encoded in the message, `String(error)`, `JSON.stringify(error)`, `inspect`, `Cause.pretty`, any span or any log line, and each read's cause is a `Redacted` of the very failure planted",
  { draw: FaultDraw, secret: EnvironmentDraw },
  ({ draw, secret }) =>
    Effect.gen(function* () {
      const reach = new Reach<string>([
        ...SECRET_FLOWS,
        ...FAULT_IDS.flatMap((id) => ["repo", "home", "app-home", "disk-set"].map((site) => `${site}:${id}`)),
        ...ENVIRONMENT_SITES.map((site) => `env:${site}`),
      ]);

      for (const one of ruleCases(draw).filter(({ id }) => SECRET_FLOWS.includes(id))) {
        const observed = yield* startOn(makeGroup(draw, [one.setting]), {
          files: { [repoPath(draw)]: placement(draw, one).text },
          env: { HOME: draw.home },
          repo: draw.repo,
        });

        // An `invalid` refusal has no failure beneath it: no cause is made up.
        expect(refusal(observed).error.cause, `(${one.id}): no cause`).toBeUndefined();
        clear(`(${one.id})`, observed, one.needles);
        reach.mark(one.id);
      }

      for (const site of ["repo", "home", "app-home", "disk-set"] as const) {
        for (const id of FAULT_IDS) {
          const fault = plant(id, draw, sitePath(draw, site));
          const observed = yield* readAt(draw, site, fault.error);

          clear(`${site} (${id})`, observed, [draw.home, draw.repo, draw.moved]);
          hidden(`${site} (${id})`, observed, fault.error);
          reach.mark(`${site}:${id}`);
        }
      }

      for (const site of ENVIRONMENT_SITES) {
        const error = new ConfigProvider.SourceError({ message: secret.message });

        const observed = yield* startOn(makeGroup(secret, [plain(secret)]), {
          provider: failing(secret, site, error),
          repo: secret.repo,
        });

        clear(`env ${site}`, observed, [secret.message]);
        hidden(`env ${site}`, observed, error);
        reach.mark(`env:${site}`);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF6, every refusal leaves a span
// ---------------------------------------------------------------------------------------------

interface Row {
  readonly id: string;
  readonly span: string;
  readonly observed: Observed;
  /** The attributes the span holds. */
  readonly attributes: Readonly<Record<string, string>>;
}

// Plants: (k) leave `edit` with no span: no `config.edit` span; (k) open `config.edit` when `edit` makes its object, not
// per call: the span ends before the failure; (r) catch the refusal inside `config.layer` and fail after it: the span ends
// as a success.
it.effect.prop(
  "RF6 every refusal leaves a span: each run makes an `invalid` (class (b)) and a `read` (class (p)) refusal through each call that can give one, and for each exactly one span of the call's name has ended as a failure whose error is the very error the call failed with, and holds the app, and the setting and the file where the call names them",
  { draw: SourceDraw },
  ({ draw }) =>
    Effect.gen(function* () {
      const one = ruleCases({ ...draw }).find(({ id }) => id === "b") ?? expect.fail("no class (b)");
      const setting = one.setting;
      const group = makeGroup(draw, [setting]);
      const name = settingName(draw);
      const app = draw.app;
      const present = { [repoPath(draw)]: "# note\n" };
      const env = { HOME: draw.home };
      const denied = denial(repoPath(draw));
      const own = plain(draw);
      const ownGroup = makeGroup(draw, [own]);
      const faults = [{ method: ["readFile", "readFileString"] as const, path: repoPath(draw), error: denied }];
      const named = { "kalfa.config.app": app, "kalfa.config.setting": name, "kalfa.config.file": "repo" };

      const rows: ReadonlyArray<Row> = [
        {
          id: "layer, invalid",
          span: "config.layer",
          observed: yield* startOn(group, {
            files: { [repoPath(draw)]: fileText(draw, one.raw) },
            env,
            repo: draw.repo,
          }),
          attributes: { "kalfa.config.app": app },
        },
        {
          id: "layer, read",
          span: "config.layer",
          observed: yield* readAt(draw, "repo", denied),
          attributes: { "kalfa.config.app": app },
        },
        {
          id: "set, invalid",
          span: "config.set",
          observed: yield* onDisk(
            group,
            setting,
            { kind: "set", value: refusedValue(one) },
            { files: present, env, repo: draw.repo },
          ),
          attributes: named,
        },
        {
          id: "set, read",
          span: "config.set",
          observed: yield* readAt(draw, "disk-set", denied),
          attributes: named,
        },
        {
          id: "remove, read",
          span: "config.remove",
          observed: yield* onDisk(ownGroup, own, { kind: "remove" }, { files: present, faults, env, repo: draw.repo }),
          attributes: named,
        },
        {
          id: "edit, invalid",
          span: "config.edit",
          observed: yield* edited(group, setting, "", refusedValue(one)),
          attributes: named,
        },
        {
          id: "list, read",
          span: "config.list",
          observed: yield* readAt(draw, "list", denied),
          attributes: { "kalfa.config.app": app },
        },
        {
          id: "command set, invalid",
          span: "config.set",
          observed: yield* command({ app, groups: [group], repo: draw.repo, env, files: present }, [
            "set",
            name,
            one.text,
          ]),
          attributes: { "kalfa.config.app": app, "kalfa.config.setting": name },
        },
      ];

      const reach = new Reach<string>(rows.map(({ id }) => id));

      for (const row of rows) {
        const error = refusal(row.observed).error;
        const spans = row.observed.spans.filter((span) => span.name === row.span);

        expect(spans, `${row.id}: exactly one ${row.span} span`).toHaveLength(1);

        const status = spans[0]?.status;

        if (status === undefined || status._tag !== "Ended") {
          return expect.fail(`${row.id}: the span has not ended`);
        }

        const failure = Exit.isFailure(status.exit) ? Cause.findErrorOption(status.exit.cause) : Option.none();

        expect(Option.isSome(failure), `${row.id}: the span's exit is the failure`).toBe(true);
        expect(Option.getOrUndefined(failure), `${row.id}: the very error`).toBe(error);

        for (const [key, value] of Object.entries(row.attributes)) {
          expect(spans[0]?.attributes.get(key), `${row.id}: ${key}`).toBe(value);
        }

        reach.mark(row.id);
      }

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// RF8, a raw cause cast past the type fails loudly
// ---------------------------------------------------------------------------------------------

// Plant: swap the field for `Schema.Any` with the `Redacted` type kept by a cast: the raw cause is taken.
it.prop(
  "RF8 a raw cause cast past the type fails loudly: `new SettingsError` with a cause that is not a `Redacted` throws, and the same call with the cause in `Redacted.make` does not and keeps it",
  { raw: Schema.Unknown.check(Schema.makeFilter((raw) => raw !== undefined)) },
  ({ raw }) => {
    // SAFETY: none, on purpose. The cast is the law: a type that stops a raw cause at compile time is not enough where a program casts past it, so the constructor must refuse it when it runs.
    expect(
      () => new SettingGroup.SettingsError({ reason: "read", fault: "f", closing: "c", cause: raw as never }),
    ).toThrow();

    const kept = new SettingGroup.SettingsError({
      reason: "read",
      fault: "f",
      closing: "c",
      cause: Redacted.make(raw),
    });

    const cause: unknown = kept.cause;

    expect(Redacted.isRedacted(cause)).toBe(true);
    expect(Redacted.isRedacted(cause) ? Redacted.value(cause) : undefined).toBe(raw);
  },
  check,
);
