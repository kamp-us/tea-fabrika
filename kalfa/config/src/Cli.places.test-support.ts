/**
 * What the laws P1 to P5, P10 and P11 of ticket 2000 share (Cli.places.test.ts): the draw, the classes of fault each with
 * the place it must carry, the sentence it must say, the code and the hint its diagnostic must have, and the runner that
 * makes each fault through a public entry (a start, a disk call, an edit, the command, a receiver of snapshots).
 *
 * Everything an expected value says is written here from the approved plan's tables ("Where each place comes from", "The
 * codes and hints", "Generators") and from today's wording of each message, never read from the code under test. Every
 * draw is an Effect Schema, so each has its own Arbitrary. A law builds one case for each class from the drawn seeds,
 * never the cross product, and `Reach.done` fails when a class was not reached. The runners, scenes and needles are the
 * refusals laws' (Cli.refusals.test-support.ts).
 */
import * as Diagnostic from "@kalfa/diagnostics/Diagnostic";
import { ConfigProvider, Effect, Option, Schema } from "effect";
import {
  command,
  denial,
  edited,
  failing,
  forms,
  homeVariable,
  keyLine,
  makeGroup,
  type Observed,
  onDisk,
  plain,
  RuleDraw,
  repoName,
  repoPath,
  ruleCases,
  settingName,
  sitePath,
  siteWords,
  startOn,
  variable,
  fileText,
} from "./Cli.refusals.test-support.ts";
import { Setting } from "./index.ts";
import { filePlace, Reach } from "./SettingGroup.edit.test-support.ts";
import { makeGroup as receiverGroup, openInbox } from "./SettingGroup.snapshot.test-support.ts";

export { Reach, forms };

// ---------------------------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------------------------

/** A home folder whose login no structural word of a place or a message can hold by chance: `lg` and six letters. */
const LoginHome = Schema.String.check(Schema.isPattern(/^\/people\/lg[a-z]{6}$/u));

/** What every law draws: the refusals laws' draw (the app, the words, a secret-looking value, the folders, the pad), a home folder with a login of its own, and the bits that pick between the ways a class can be made. */
export const PlaceDraw = Schema.Struct({
  ...RuleDraw.fields,
  home: LoginHome,
  bits: Schema.Array(Schema.Boolean).check(Schema.isMinLength(6), Schema.isMaxLength(6)),
  pick: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
});

export type PlaceDraw = typeof PlaceDraw.Type;

/** The drawn login: the last part of the drawn home folder. */
export const loginFrom = (draw: PlaceDraw) => draw.home.slice("/people/".length);

// ---------------------------------------------------------------------------------------------
// The classes
// ---------------------------------------------------------------------------------------------

/** A fault that has a place (the plan's "Generators": the classes with a file's place, then a variable's or a flag's). */
export type PlacedId =
  | "r"
  | "h"
  | "m"
  | "s"
  | "u"
  | "v"
  | "q"
  | "d"
  | "w"
  | "x"
  | "c"
  | "i"
  | "j"
  | "e"
  | "f"
  | "o"
  | "g"
  | "n"
  | "a";

export const PLACED_IDS: ReadonlyArray<PlacedId> = [
  "r",
  "h",
  "m",
  "s",
  "u",
  "v",
  "q",
  "d",
  "w",
  "x",
  "c",
  "i",
  "j",
  "e",
  "f",
  "o",
  "g",
  "n",
  "a",
];

/** A fault with no place: a snapshot stream that ends before its first item (k), and a typed name that is no setting (t). */
export type UnplacedId = "k" | "t";

export const UNPLACED_IDS: ReadonlyArray<UnplacedId> = ["k", "t"];

export type PlaceId = PlacedId | UnplacedId;

type Reason =
  | "version"
  | "syntax"
  | "unknown"
  | "scope"
  | "invalid"
  | "missing"
  | "read"
  | "edit"
  | "write"
  | "snapshot";

export interface PlaceCase {
  readonly id: PlaceId;
  /** The reason the one error must have. */
  readonly reason: Reason;
  /** The place it must hold, written from the plan's table, or none. */
  readonly place: Diagnostic.Place | undefined;
  /** What is wrong, as today's message says it, between its opening and its closing. */
  readonly fault: string;
  /** The sentence that ends today's message. */
  readonly closing: string;
  /** The fault, made through its public entry. */
  readonly run: Effect.Effect<Observed>;
  /** What a place, a diagnostic and a codec's text must hold none of. */
  readonly needles: ReadonlyArray<string>;
}

const VERSION = "1.2.3";

/** The refused value of every class that refuses one: the drawn secret, where the setting wants a number. */
const refusal = (draw: PlaceDraw) => {
  const one = ruleCases(draw).find(({ id }) => id === "a");

  if (one === undefined) {
    throw new Error("no class (a) in the refusals laws' draws");
  }

  return one;
};

/** What a refused value is said to be: the schema of class (a) wants a number, and a text that a variable, a flag or the command gives it is read as one. */
const invalid = (name: string, asText: boolean) =>
  `${name} is not a valid value. Expected ${asText ? "a string representing a finite number" : "number"}.`;

/** The two files as a person reads them where nothing moves the user file: `.<app>/<app>.toml` and `~/.<app>/<app>.toml`. */
const shown = (draw: PlaceDraw): Readonly<Record<Setting.File, string>> => ({
  repo: repoName(draw),
  user: `~/.${draw.app}/${draw.app}.toml`,
});

/** Where a setting may be set, as a message says it: its files, then its variable unless only a file may set it. */
const scopeText = (draw: PlaceDraw, files: ReadonlyArray<Setting.File>, withVariable: boolean) =>
  [...files.map((file) => shown(draw)[file]), ...(withVariable ? [`as ${variable(draw)}`] : [])]
    .map((place, n, all) =>
      n === 0 ? place : n === all.length - 1 && place.startsWith("as ") ? `, or ${place}` : ` or ${place}`,
    )
    .join("");

const environment = (name: string) => Diagnostic.Place.cases.environment.make({ name });

const flag = (name: string) => Diagnostic.Place.cases.flag.make({ name });

/** The notes before a key, as the refusals laws write them. */
const notes = (draw: PlaceDraw) => Array.from({ length: draw.pad }, (_, n) => `# note ${n}\n`).join("");

const did = (draw: PlaceDraw) => `${draw.app} did not start.`;

const started = (draw: PlaceDraw) => ({ HOME: draw.home });

/** A setting of the drawn name that nothing refuses and that may be set where `files` says. */
const scoped = (draw: PlaceDraw, files: Setting.Files) =>
  Setting.make(settingName(draw), Schema.Finite).pipe(
    Setting.withDescription("A setting."),
    Setting.withDefault(1),
    Setting.files(files),
  );

/** Every class of fault, each built from the drawn seeds. */
export const placeCases = (draw: PlaceDraw): ReadonlyArray<PlaceCase> => {
  const one = refusal(draw);
  const group = makeGroup(draw, [one.setting]);
  const name = settingName(draw);
  const ordinary = plain(draw);
  const ordinaryGroup = makeGroup(draw, [ordinary]);
  const [first, second, third, fourth, fifth, sixth] = draw.bits;
  const secrets = forms(draw.secret);
  const privates = [loginFrom(draw), draw.home, draw.repo, draw.moved];
  const held = { files: { [repoPath(draw)]: "# note\n" }, env: started(draw), repo: draw.repo };

  // The user file's own name and path: under `HOME`, or under `$<APP>_HOME`.
  const userFilePath = (moved: boolean) => sitePath(draw, moved ? "app-home" : "home");
  const userFileName = (moved: boolean) => siteWords(draw, moved ? "app-home" : "home").file;
  const homeEnv = (moved: boolean) => ({ HOME: draw.home, ...(moved ? { [homeVariable(draw)]: draw.moved } : {}) });

  const refusedIn = (file: Setting.File, moved: boolean): PlaceCase["run"] =>
    startOn(group, {
      files: { [file === "repo" ? repoPath(draw) : userFilePath(moved)]: fileText(draw, one.raw) },
      env: homeEnv(moved),
      repo: draw.repo,
    });

  const fileEnds = (file: Setting.File) => `The ${file === "repo" ? "repo" : "user"} configuration was not changed.`;

  // (i) a value `config set` was given that the schema refuses: the file `--file` names, else the setting's first file.
  const settingFirstUser = one.setting.pipe(Setting.files(["user", "repo"]));
  const chosen: Setting.File = fifth === true ? "repo" : "user";

  // (x) an edit of a setting in the file it may not be set in; (c) of a text where the setting is not one key; (j) of a setting of another group.
  const editedFile: Setting.File = sixth === true ? "user" : "repo";
  const otherFile: Setting.File = editedFile === "repo" ? "user" : "repo";
  const barred = scoped(draw, [otherFile]);
  const unchanged = `${shown(draw)[editedFile]} was not changed.`;

  // (q) a required setting nothing sets: the first file it may be set in, by the drawn order.
  const order: Setting.Files = first === true ? ["user", "repo"] : ["repo", "user"];
  const firstFile = order[0];

  const required = Setting.make(name, Schema.Finite).pipe(Setting.withDescription("A setting."), Setting.files(order));

  // (s) a file that is not TOML, the repo's or the user's.
  const brokenFile: Setting.File = second === true ? "user" : "repo";

  // (n) and (a): which site of the environment does not answer.
  const homeSite = third === true ? "app-home" : "home";
  const settingSite = fourth === true ? "holder" : "resolve";
  const unanswered = `could not be read, because the environment did not answer.`;
  const failure = new ConfigProvider.SourceError({ message: draw.secret });

  // (o) and (g) a file-only setting named by its variable, and given a flag by hand.
  const fileOnly = Setting.make(name, Schema.Finite).pipe(
    Setting.withDescription("A setting."),
    Setting.withDefault(1),
    Setting.fileOnly,
  );

  const fileOnlyScope = (named: string) =>
    `${named}: ${name} may be set only in ${scopeText(draw, ["repo", "user"], false)}.`;

  const typed = "unlisted.keyword.nobody";
  const sub = (["get", "set", "remove"] as const)[draw.pick] ?? "get";

  return [
    {
      id: "r",
      reason: "invalid",
      place: filePlace("repo", repoName(draw), keyLine(draw)),
      fault: invalid(name, false),
      closing: did(draw),
      run: refusedIn("repo", false),
      needles: [...secrets, ...privates],
    },
    {
      id: "h",
      reason: "invalid",
      place: filePlace("user", userFileName(false), keyLine(draw)),
      fault: invalid(name, false),
      closing: did(draw),
      run: refusedIn("user", false),
      needles: [...secrets, ...privates],
    },
    {
      id: "m",
      reason: "invalid",
      place: filePlace("user", userFileName(true), keyLine(draw)),
      fault: invalid(name, false),
      closing: did(draw),
      run: refusedIn("user", true),
      needles: [...secrets, ...privates],
    },
    {
      id: "s",
      reason: "syntax",
      place: filePlace(brokenFile, brokenFile === "repo" ? repoName(draw) : userFileName(false), draw.pad + 2),
      fault: "this is not valid TOML.",
      closing: did(draw),
      run: startOn(ordinaryGroup, {
        files: { [brokenFile === "repo" ? repoPath(draw) : userFilePath(false)]: fileText(draw, "}") },
        env: started(draw),
        repo: draw.repo,
      }),
      needles: privates,
    },
    {
      id: "u",
      reason: "unknown",
      place: filePlace("user", userFileName(false), draw.pad + 2),
      fault: "there is no setting unrelated.keyword.",
      closing: did(draw),
      run: startOn(ordinaryGroup, {
        files: { [userFilePath(false)]: `${notes(draw)}[unrelated]\nkeyword = 1\n` },
        env: started(draw),
        repo: draw.repo,
      }),
      needles: privates,
    },
    {
      id: "v",
      reason: "version",
      place: filePlace("repo", repoName(draw), draw.pad + 1),
      fault: `this repo needs ${draw.app} 9.9.9 or newer. You have ${VERSION}.`,
      closing: did(draw),
      run: startOn(ordinaryGroup, {
        files: { [repoPath(draw)]: `${notes(draw)}${draw.app}-version = "9.9.9"\n` },
        env: started(draw),
        repo: draw.repo,
      }),
      needles: privates,
    },
    {
      id: "q",
      reason: "missing",
      place: filePlace(firstFile ?? "repo", shown(draw)[firstFile ?? "repo"]),
      fault: `${name} is required, and nothing sets it. Set it in ${scopeText(draw, order, true)}.`,
      closing: did(draw),
      run: startOn(makeGroup(draw, [required]), { env: started(draw), repo: draw.repo }),
      needles: privates,
    },
    {
      id: "d",
      reason: "read",
      place: filePlace("repo", repoName(draw)),
      fault: "could not be read, because permission was denied.",
      closing: `${repoName(draw)} was not changed.`,
      run: onDisk(
        ordinaryGroup,
        ordinary,
        { kind: "set", value: 2 },
        {
          files: held.files,
          faults: [{ method: ["readFile", "readFileString"], path: repoPath(draw), error: denial(repoPath(draw)) }],
          env: held.env,
          repo: draw.repo,
        },
      ),
      needles: privates,
    },
    {
      id: "w",
      reason: "write",
      place: filePlace("repo", `${repoName(draw)}.lock`),
      fault:
        "another change is under way, or an earlier one stopped before it finished. If none is running, remove this file.",
      closing: `${repoName(draw)} was not changed.`,
      run: onDisk(
        ordinaryGroup,
        ordinary,
        { kind: "set", value: 2 },
        { files: { ...held.files, [`${repoPath(draw)}.lock`]: "" }, env: held.env, repo: draw.repo },
      ),
      needles: privates,
    },
    {
      id: "x",
      reason: "scope",
      place: filePlace(editedFile, shown(draw)[editedFile]),
      fault: `${name} may be set only in ${scopeText(draw, [otherFile], true)}.`,
      closing: unchanged,
      run: edited(makeGroup(draw, [barred]), barred, "", 2, editedFile),
      needles: privates,
    },
    {
      id: "c",
      reason: "edit",
      place: filePlace(editedFile, shown(draw)[editedFile], draw.pad + 1),
      fault: `${name} is not one key in this text, so it cannot be changed as one.`,
      closing: unchanged,
      run: edited(
        ordinaryGroup,
        ordinary,
        `${notes(draw)}${draw.words[0]} = { ${draw.words[1]}.x = 1 }\n`,
        5,
        editedFile,
      ),
      needles: privates,
    },
    {
      id: "i",
      reason: "invalid",
      place: filePlace(chosen, shown(draw)[chosen]),
      fault: invalid(name, true),
      closing: fileEnds(chosen),
      run: command({ app: draw.app, groups: [makeGroup(draw, [settingFirstUser])], ...held }, [
        "set",
        name,
        draw.secret,
        ...(fifth === true ? ["--file", "repo"] : []),
      ]),
      needles: [...secrets, ...privates],
    },
    {
      id: "j",
      reason: "unknown",
      place: filePlace(editedFile, shown(draw)[editedFile]),
      fault: `x0${draw.words[2]}.x0${draw.words[3]} is not a setting of ${draw.app}.`,
      closing: unchanged,
      run: edited(
        ordinaryGroup,
        Setting.make(`x0${draw.words[2]}.x0${draw.words[3]}`, Schema.Finite).pipe(
          Setting.withDescription("A setting of another group."),
          Setting.withDefault(1),
        ),
        "",
        2,
        editedFile,
      ),
      needles: privates,
    },
    {
      id: "e",
      reason: "invalid",
      place: environment(variable(draw)),
      fault: invalid(variable(draw), true),
      closing: did(draw),
      run: startOn(group, { env: { ...started(draw), [variable(draw)]: one.text }, repo: draw.repo }),
      needles: [...secrets, ...privates],
    },
    {
      id: "f",
      reason: "invalid",
      place: flag(`--${name}`),
      fault: invalid(`--${name}`, true),
      closing: did(draw),
      run: startOn(group, { env: started(draw), flags: { [name]: Option.some(one.text) }, repo: draw.repo }),
      needles: [...secrets, ...privates],
    },
    {
      id: "o",
      reason: "scope",
      place: environment(variable(draw)),
      fault: fileOnlyScope(variable(draw)),
      closing: did(draw),
      run: startOn(makeGroup(draw, [fileOnly]), {
        env: { ...started(draw), [variable(draw)]: "4200" },
        repo: draw.repo,
      }),
      needles: privates,
    },
    {
      id: "g",
      reason: "scope",
      place: flag(`--${name}`),
      fault: fileOnlyScope(`--${name}`),
      closing: did(draw),
      run: startOn(makeGroup(draw, [fileOnly]), {
        env: started(draw),
        flags: { [name]: Option.some("4200") },
        repo: draw.repo,
      }),
      needles: privates,
    },
    {
      id: "n",
      reason: "read",
      place: environment(homeSite === "app-home" ? homeVariable(draw) : "HOME"),
      fault: `${homeSite === "app-home" ? homeVariable(draw) : "HOME"} ${unanswered}`,
      closing: did(draw),
      run: startOn(ordinaryGroup, { provider: failing(draw, homeSite, failure), repo: draw.repo }),
      needles: [...forms(draw.secret), ...privates],
    },
    {
      id: "a",
      reason: "read",
      place: environment(variable(draw)),
      // The message names the setting, and the place names its variable.
      fault: `${name} ${unanswered}`,
      closing: did(draw),
      run: startOn(ordinaryGroup, { provider: failing(draw, settingSite, failure), repo: draw.repo }),
      needles: [...forms(draw.secret), ...privates],
    },
    {
      id: "k",
      reason: "snapshot",
      place: undefined,
      fault: "no snapshot came before the stream ended.",
      closing: did(draw),
      run: Effect.map(
        Effect.exit(openInbox(receiverGroup(draw.app, [{ name, kind: "number" }]), [], { ending: true })),
        (exit): Observed => ({
          exit,
          spans: [],
          logs: [],
          files: {},
          stdout: "",
        }),
      ),
      needles: privates,
    },
    {
      id: "t",
      reason: "unknown",
      place: undefined,
      fault: `there is no setting ${typed}.`,
      closing: sub === "get" ? "Nothing was read." : "Nothing was changed.",
      run: command({ app: draw.app, groups: [ordinaryGroup], ...held }, [sub, typed, ...(sub === "set" ? ["1"] : [])]),
      needles: privates,
    },
  ] satisfies ReadonlyArray<PlaceCase>;
};

// ---------------------------------------------------------------------------------------------
// What each case must say
// ---------------------------------------------------------------------------------------------

/**
 * How today's message opens, by the rule the plan keeps: a fault found in a file opens with the file and its line when it has one, a variable's or a flag's fault names itself in the fault, and a missing setting's message has no opening, since its place says where to fix it and not where it was found.
 */
export const opening = (one: Pick<PlaceCase, "reason" | "place">) =>
  one.place === undefined || one.place._tag === "environment" || one.place._tag === "flag" || one.reason === "missing"
    ? ""
    : `${one.place.path}${one.place.line === undefined ? "" : `, line ${one.place.line}`}: `;

/** Today's whole message of a case, byte for byte. */
export const messageFor = (one: PlaceCase) => `${opening(one)}${one.fault}\n  ${one.closing}`;

/** The nine codes and their hints, from the plan's table "The codes and hints": one code and one fixed sentence for each reason that can carry a place. */
export const CODES: Readonly<Record<Exclude<Reason, "snapshot">, { readonly code: string; readonly hint: string }>> = {
  version: {
    code: "config/version",
    hint: "Install a newer release of the app, or lower the repo's minimum version.",
  },
  syntax: { code: "config/syntax", hint: "Fix the text at this place so the file can be read." },
  unknown: {
    code: "config/unknown-setting",
    hint: "Check the name against the app's settings reference, or remove the key.",
  },
  scope: { code: "config/scope", hint: "Set it in one of the places the message names." },
  invalid: { code: "config/invalid", hint: "Give a value that keeps the rule the message names." },
  missing: { code: "config/missing", hint: "Set it in one of the places the message names." },
  read: { code: "config/read", hint: "Check that the app may read this place, then run it again." },
  edit: { code: "config/edit", hint: "Make this change by hand in the file." },
  write: { code: "config/write", hint: "Check that the folder is there and may be written, then run it again." },
};

// ---------------------------------------------------------------------------------------------
// P5, the places the constructor must refuse, and their good twins
// ---------------------------------------------------------------------------------------------

export type BadId = "absolute" | "login" | "repo-home" | "environment-line";

export const BAD_IDS: ReadonlyArray<BadId> = ["absolute", "login", "repo-home", "environment-line"];

export interface Bad {
  readonly id: BadId;
  /** A place the constructor must refuse. */
  readonly bad: unknown;
  /** The same kind of place with the fault mended: it must be kept as it is. */
  readonly good: Diagnostic.Place;
}

/** A home place with an absolute path, one that names a login, a repo place that starts with `~/`, and an environment place with a line, each with its good twin. */
export const badPlaces = (draw: PlaceDraw): ReadonlyArray<Bad> => {
  const file = `.${draw.app}/${draw.app}.toml`;
  // The makers check a place as the constructor does, so a bad one is made with the checks off: this is the input the constructor must refuse.
  const unchecked = { disableChecks: true } as const;

  return [
    {
      id: "absolute",
      bad: Diagnostic.Place.cases.home.make({ path: `${draw.home}/${file}` }, unchecked),
      good: Diagnostic.Place.cases.home.make({ path: `~/${file}` }),
    },
    {
      id: "login",
      bad: Diagnostic.Place.cases.home.make({ path: `~${loginFrom(draw)}/${file}` }, unchecked),
      good: Diagnostic.Place.cases.home.make({ path: `~/${file}` }),
    },
    {
      id: "repo-home",
      bad: Diagnostic.Place.cases.repo.make({ path: `~/${file}` }, unchecked),
      good: Diagnostic.Place.cases.repo.make({ path: file }),
    },
    {
      id: "environment-line",
      // The type has no line for a variable, so the line is added to a made place.
      bad: Object.assign(Diagnostic.Place.cases.environment.make({ name: variable(draw) }), { line: 1 }),
      good: Diagnostic.Place.cases.environment.make({ name: variable(draw) }),
    },
  ];
};

// ---------------------------------------------------------------------------------------------
// P11, a running version that is not a version
// ---------------------------------------------------------------------------------------------

/** A start whose repo file asks for a minimum version, run with a running version that is not one: the drawn secret-looking text. */
export const badVersionStart = (draw: PlaceDraw) =>
  startOn(makeGroup(draw, [plain(draw)]), {
    files: { [repoPath(draw)]: `${notes(draw)}${draw.app}-version = "1.0.0"\n` },
    env: started(draw),
    repo: draw.repo,
    version: draw.secret,
  });
