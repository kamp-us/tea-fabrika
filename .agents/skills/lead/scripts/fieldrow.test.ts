// Today's lead tooling. The laws of fieldrow.ts, the port of fieldrow.py (ticket 766, slice S3 of
// docs/plan/quests/port-scripts-0113-PLAN.md, after decision 0113). Written before the port.
//
// The shape these laws hold fieldrow.ts to:
// - It exports `fieldrow`, its `effect/cli` command, with fieldrow.py's command line: the flags
//   `--parent`, `--model`, `--effort`, `--step`, `--started`, `--ended`, `--start`, `--end` and
//   `--status` (a whole number), then the events file, the run, the ticket, the outcome and one or
//   more words of reason. It runs only when the file is run as a program.
// - It prints the row with `Console.log`, one JSON line, and nothing else on stdout.
// - It reads the events file and its `<events>.redacted` receipt through Effect's `FileSystem`
//   (`exists`, `stat`, `readFileString` or `readFile`), the time from `Clock`, the zone from
//   `DateTime.CurrentTimeZone`, requested-profile events, and older `CODEX_MODEL` and
//   `CODEX_EFFORT` values through Effect's `Config`.
//   When no `--started` or `--ended` is given, the events file's birth and change times are the
//   row's bounds; with no events file either, both are the clock's now.
//
// The oracle below is fieldrow.py's rules, restated. Before fieldrow.py was deleted, the tests step
// ran the oracle against fieldrow.py itself on generated events files and given times, and they
// agreed (field/runs/2026-11-16-port-s3-tests.json). Everything here is in memory: no process, no
// disk, no real clock.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { ByteSize, DateTime, Effect, Exit, FileSystem, Layer, Option, PlatformError, Predicate } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import fc from "fast-check";
import { run as runFieldrow } from "./fieldrow.ts";

const EVENTS = "/box/out/events.jsonl";

const RECEIPT = `${EVENTS}.redacted`;

/**
 * fieldrow.py's price table, dollars per million tokens (in, cached, out). The test's own copy, so
 * a plant in the product's table cannot move the oracle with it.
 */
const LIST = new Map<string, readonly [number, number, number]>([
  ["gpt-6.1-sol", [2, 0.1, 10]],
  ["gpt-6-astra", [10, 1, 50]],
]);

interface Usage {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

/** One line of a Codex events file, and what fieldrow.py makes of it. */
type Line =
  | { readonly _tag: "turn"; readonly usage: Usage; readonly text: string }
  | { readonly _tag: "skipped"; readonly text: string }
  | {
      readonly _tag: "profile";
      readonly model: unknown;
      readonly effort: unknown;
      readonly text: string;
    };

type ProfileLine = Extract<Line, { readonly _tag: "profile" }>;

const isProfile = (line: Line): line is ProfileLine => line._tag === "profile";

const profileValue = (value: unknown): string | null => (Predicate.isString(value) && value.length > 0 ? value : null);

interface Case {
  readonly zone: string;
  readonly now: number;
  /** The events file's lines, or null when there is no events file. */
  readonly lines: ReadonlyArray<Line> | null;
  readonly birth: number;
  readonly changed: number;
  readonly started: string | null;
  readonly ended: string | null;
  readonly model: { readonly flag: string | null; readonly env: string | null };
  readonly effort: { readonly flag: string | null; readonly env: string | null };
  readonly parent: string | null;
  readonly step: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly status: number | null;
  readonly receipt: number | null;
  readonly run: string;
  readonly ticket: string;
  readonly outcome: string;
  readonly reason: ReadonlyArray<string>;
}

// ---------------------------------------------------------------- the oracle: fieldrow.py, restated

/** A zone's offset at an instant, as Python's isoformat writes it: `-08:00`, `+05:30`, `+00:00`. */
const offsetAt = (ms: number, zone: string): { readonly minutes: number; readonly text: string } => {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date(ms))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  const text = name === "GMT" ? "+00:00" : name.slice(3);
  const sign = text.startsWith("-") ? -1 : 1;

  return { minutes: sign * (Number(text.slice(1, 3)) * 60 + Number(text.slice(4, 6))), text };
};

/** An instant as Python's `datetime.fromtimestamp(t).astimezone().isoformat(timespec="seconds")`. */
const localIso = (ms: number, zone: string): string => {
  const { minutes, text } = offsetAt(ms, zone);
  const clock = new Date(Math.floor(ms / 1000) * 1000 + minutes * 60_000).toISOString().slice(0, 19);

  return `${clock}${text}`;
};

/**
 * Python's `round(x, places)`: the nearest on the exact value, and a tie to the even digit.
 * `toFixed` is the nearest on the exact value too, but takes a tie away from zero. A double is a
 * tie at `places` only when it is an odd number of halves of `2 ** -places` (a minute of 15 seconds
 * is 0.25), so only that case is mended. -0 reads as 0, as a JSON number written from 0 does.
 */
const pyRound = (x: number, places: number): number => {
  const digits = Number(Math.abs(x).toFixed(places).replace(".", ""));
  const halves = Math.abs(x) * 2 ** (places + 1);
  const tie = Number.isInteger(halves) && halves % 2 === 1;

  return Math.sign(x) * Number(`${tie && digits % 2 === 1 ? digits - 1 : digits}e-${places}`) + 0;
};

/** The usage fieldrow.py sums: whole numbers in all three counts of a `turn.completed` event. */
const summed = (lines: ReadonlyArray<Line> | null): Usage | null => {
  const turns = (lines ?? []).flatMap((line) => (line._tag === "turn" ? [line.usage] : []));

  return turns.length === 0
    ? null
    : turns.reduce((sum, u) => ({
        input: sum.input + u.input,
        cached: sum.cached + u.cached,
        output: sum.output + u.output,
      }));
};

/**
 * The row fieldrow.py prints for this case, its keys in fieldrow.py's order. The row's own key for
 * the reason is `why`; here it is `reason`, the word this repo's new code uses.
 */
const expected = (c: Case): Record<string, unknown> => {
  const profile = (c.lines ?? []).find(isProfile);
  const modelValue = c.model.flag ?? (profile === undefined ? c.model.env || null : profileValue(profile.model));
  const effortValue = c.effort.flag ?? (profile === undefined ? c.effort.env || null : profileValue(profile.effort));
  const model = modelValue || "unknown";
  const effort = effortValue || null;

  const requested =
    profile !== undefined ||
    c.model.flag !== null ||
    c.effort.flag !== null ||
    modelValue !== null ||
    effortValue !== null;

  const begun =
    c.started === null
      ? { ms: c.lines === null ? c.now : c.birth, iso: localIso(c.lines === null ? c.now : c.birth, c.zone) }
      : { ms: Date.parse(c.started), iso: c.started };

  const ended =
    c.ended === null
      ? { ms: c.lines === null ? c.now : c.changed, iso: localIso(c.lines === null ? c.now : c.changed, c.zone) }
      : { ms: Date.parse(c.ended), iso: c.ended };

  const u = summed(c.lines);
  const rate = LIST.get(model);

  const profileNote = requested
    ? ` Requested profile: model ${model}, effort ${effort ?? "unknown"}; effective API context unknown.`
    : "";

  const priceNote =
    rate === undefined
      ? ""
      : ` Dollars are ${model}'s standard list price (packages/pipeline/src/stages/price.ts); runs use the standard tier.`;

  const usd =
    rate === undefined || u === null
      ? null
      : pyRound(((u.input - u.cached) * rate[0] + u.cached * rate[1] + u.output * rate[2]) / 1e6, 4);

  const stepped =
    c.step === null
      ? {}
      : {
          step: c.step,
          ...(c.start === null ? {} : { start: c.start }),
          ...(c.end === null ? {} : { end: c.end }),
          ...(c.status === null ? {} : { status: c.status }),
        };

  return {
    date: begun.iso.slice(0, 10),
    run: c.run,
    ticket: c.ticket,
    pr: null,
    started: begun.iso,
    ended: ended.iso,
    parent: c.parent,
    active: null,
    role: "hand",
    model,
    effort,
    outcome: c.outcome,
    reason: `${c.reason.join(" ")}${profileNote}${priceNote}`,
    tokens: null,
    tools: null,
    minutes: pyRound((ended.ms - begun.ms) / 1000 / 60, 1),
    note: null,
    costUsd: null,
    listUsd: usd,
    billed: u === null ? null : u.input + u.output,
    inputTokens: u === null ? null : u.input,
    cachedTokens: u === null ? null : u.cached,
    outputTokens: u === null ? null : u.output,
    ...stepped,
    ...(c.receipt === null ? {} : { redacted: c.receipt }),
  };
};

// ---------------------------------------------------------------- the generators

const count = (max: number) => fc.integer({ min: 0, max });

const usage = fc
  .record({ fresh: count(5_000_000), cached: count(5_000_000), output: count(2_000_000) })
  .map(({ cached, fresh, output }) => ({ input: fresh + cached, cached, output }));

const KEYS = ["input_tokens", "cached_input_tokens", "output_tokens"] as const;

const said = (u: Usage) => ({ input_tokens: u.input, cached_input_tokens: u.cached, output_tokens: u.output });

/** A completed turn, sometimes with keys fieldrow.py does not read. */
const turn: fc.Arbitrary<Line> = fc
  .record({ usage, extra: fc.option(count(9_000), { nil: undefined }) })
  .map(({ extra, usage: u }) => ({
    _tag: "turn",
    usage: u,
    text: JSON.stringify({
      type: "turn.completed",
      usage: extra === undefined ? said(u) : { ...said(u), reasoning_output_tokens: extra },
    }),
  }));

/** A line fieldrow.py reads past: not JSON, another event, or a usage it cannot sum. */
const skipped: fc.Arbitrary<Line> = fc
  .oneof(
    fc.constantFrom("", "partial{", "not json at all", '{"type":"turn.completed"'),
    usage.map((u) => JSON.stringify({ type: "item.completed", usage: said(u) })),
    fc.constant(JSON.stringify({ type: "turn.completed", usage: [] })),
    fc.constant(JSON.stringify({ type: "turn.completed", usage: "input_tokens" })),
    fc
      .record({
        usage,
        key: fc.constantFrom(...KEYS),
        bad: fc.constantFrom<unknown>(undefined, null, 1.5, "7", [3], { n: 1 }),
      })
      .map(({ bad, key, usage: u }) => JSON.stringify({ type: "turn.completed", usage: { ...said(u), [key]: bad } })),
  )
  .map((text) => ({ _tag: "skipped", text }));

/** A requested profile bound to the event stream. */
const requestedProfile = (model: unknown, effort: unknown): Line => ({
  _tag: "profile",
  model,
  effort,
  text: JSON.stringify({
    type: "fabrika.requested_profile",
    ...(model === null ? {} : { model }),
    ...(effort === null ? {} : { effort }),
  }),
});

const profile: fc.Arbitrary<Line> = fc
  .record({
    model: fc.option(fc.constantFrom<unknown>("gpt-6-luna", "gpt-6.2-astra", "gpt-6.1-sol", "", null, 0, false), {
      nil: null,
    }),
    effort: fc.option(fc.constantFrom<unknown>("max", "high", "medium", "", null, 0, false), { nil: null }),
  })
  .map(({ model, effort }) => requestedProfile(model, effort));

const profilePair: fc.Arbitrary<ReadonlyArray<Line>> = fc
  .record({
    model: fc.constantFrom<unknown>("gpt-6-luna", "gpt-6.2-astra", "", 0, false),
    effort: fc.constantFrom<unknown>("max", "high", "", 0, false),
  })
  .map(({ model, effort }) => [
    requestedProfile(model, effort),
    requestedProfile(
      profileValue(model) === "gpt-6-luna" ? "gpt-6.2-astra" : "gpt-6-luna",
      profileValue(effort) === "max" ? "high" : "max",
    ),
  ]);

// Some events files carry no requested profile, so the flags and the older CODEX_MODEL and
// CODEX_EFFORT values decide the model and effort (fieldrow.py reads them only then).
const events: fc.Arbitrary<ReadonlyArray<Line>> = fc.oneof(
  fc.array(fc.oneof(turn, skipped, profile), { maxLength: 8 }),
  fc.array(fc.oneof(turn, skipped), { maxLength: 8 }),
  profilePair,
);

const ZONES = ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Europe/Istanbul"] as const;

const OFFSETS = ["+00:00", "-08:00", "-07:00", "+05:30", "+03:00"] as const;

const FROM = Date.UTC(2025, 0, 1);

const TO = Date.UTC(2027, 0, 1);

/** A time as box.sh passes it: `datetime.now().astimezone().isoformat(timespec="seconds")`. */
const given = (ms: number, offset: string): string => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));

  return `${new Date(Math.floor(ms / 1000) * 1000 + minutes * 60_000).toISOString().slice(0, 19)}${offset}`;
};

const word = fc.stringMatching(/^[a-zé0-9][a-zé0-9.]{0,7}$/);

const sha = fc.stringMatching(/^[0-9a-f]{7,12}$/);

const named = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom("gpt-6.1-sol", "gpt-6-astra", "gpt-made-up-1") },
  { weight: 1, arbitrary: fc.constantFrom(...Object.getOwnPropertyNames(Object.prototype)) },
  {
    weight: 1,
    arbitrary: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,30}$/).filter((model) => !LIST.has(model)),
  },
);

const cases: fc.Arbitrary<Case> = fc
  .record({
    zone: fc.constantFrom(...ZONES),
    now: fc.integer({ min: FROM, max: TO }),
    lines: fc.option(events, { nil: null, freq: 5 }),
    birth: fc.integer({ min: FROM, max: TO }),
    // Milliseconds, as a file's change time has them: the row prints whole seconds.
    took: fc.integer({ min: 0, max: 5 * 3_600_000 }),
    times: fc.option(
      fc.record({
        at: fc.integer({ min: FROM, max: TO }),
        took: fc.integer({ min: 0, max: 5 * 3600 }),
        from: fc.constantFrom(...OFFSETS),
        to: fc.constantFrom(...OFFSETS),
        only: fc.constantFrom("both", "started", "ended"),
      }),
      { nil: null },
    ),
    model: fc.record({
      flag: fc.option(fc.oneof(named, fc.constant("")), { nil: null }),
      env: fc.option(fc.oneof(named, fc.constant("")), { nil: null }),
    }),
    effort: fc.record({
      flag: fc.option(fc.constantFrom("", "low", "medium", "high"), { nil: null }),
      env: fc.option(fc.constantFrom("", "low", "medium", "high", "xhigh"), { nil: null }),
    }),
    parent: fc.option(word, { nil: null }),
    step: fc.option(fc.constantFrom("tests", "build", "review"), { nil: null }),
    start: fc.option(sha, { nil: null }),
    end: fc.option(sha, { nil: null }),
    status: fc.option(fc.integer({ min: 0, max: 255 }), { nil: null }),
    receipt: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
    run: word,
    ticket: fc.stringMatching(/^[1-9][0-9]{0,3}$/),
    outcome: fc.constantFrom("done", "stuck"),
    reason: fc.array(word, { minLength: 1, maxLength: 4 }),
  })
  .map(({ birth, times, took, ...rest }) => ({
    ...rest,
    birth,
    changed: birth + took,
    started: times === null || times.only === "ended" ? null : given(times.at, times.from),
    ended: times === null || times.only === "started" ? null : given(times.at + times.took * 1000, times.to),
  }));

// ---------------------------------------------------------------- one run of the command, in memory

const notFound = (method: string) =>
  PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method, description: "no such made-up file" });

/** A disk that holds only this case's events file and receipt, with the events file's two times. */
const disk = (c: Case) => {
  const files = new Map<string, string>();

  if (c.lines !== null) {
    files.set(EVENTS, `${c.lines.map((line) => line.text).join("\n")}\n`);
  }

  if (c.receipt !== null) {
    files.set(RECEIPT, `${c.receipt}\n`);
  }

  const text = (path: string, method: string) => {
    const held = files.get(path);

    return held === undefined ? Effect.fail(notFound(method)) : Effect.succeed(held);
  };

  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(path)),
    readFileString: (path) => text(path, "readFileString"),
    readFile: (path) => Effect.map(text(path, "readFile"), (held) => new TextEncoder().encode(held)),
    stat: (path) =>
      Effect.map(text(path, "stat"), (held) => ({
        type: "File" as const,
        mtime: Option.some(new Date(path === EVENTS ? c.changed : c.birth)),
        atime: Option.some(new Date(path === EVENTS ? c.changed : c.birth)),
        birthtime: Option.some(new Date(c.birth)),
        dev: 1n,
        ino: Option.none(),
        mode: 0o100644,
        nlink: Option.none(),
        uid: Option.none(),
        gid: Option.none(),
        rdev: Option.none(),
        size: ByteSize.bytes(held.length),
        blksize: Option.none(),
        blocks: Option.none(),
      })),
  });
};

const argv = (c: Case): ReadonlyArray<string> => [
  ...(c.parent === null ? [] : ["--parent", c.parent]),
  ...(c.model.flag === null ? [] : ["--model", c.model.flag]),
  ...(c.effort.flag === null ? [] : ["--effort", c.effort.flag]),
  ...(c.step === null ? [] : ["--step", c.step]),
  ...(c.started === null ? [] : ["--started", c.started]),
  ...(c.ended === null ? [] : ["--ended", c.ended]),
  ...(c.start === null ? [] : ["--start", c.start]),
  ...(c.end === null ? [] : ["--end", c.end]),
  ...(c.status === null ? [] : ["--status", String(c.status)]),
  EVENTS,
  c.run,
  c.ticket,
  c.outcome,
  ...c.reason,
];

const env = (c: Case): Record<string, string> => ({
  ...(c.model.env === null ? {} : { CODEX_MODEL: c.model.env }),
  ...(c.effort.env === null ? {} : { CODEX_EFFORT: c.effort.env }),
});

/** One run of `fieldrow` on this case: how it exited and what it printed. */
const run = (c: Case) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(c.now);
    const exit = yield* runFieldrow(argv(c), env(c)).pipe(Effect.exit);
    const stdout = (yield* TestConsole.logLines).map(String);
    const stderr = (yield* TestConsole.errorLines).map(String);

    return { exit, stdout, stderr };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(disk(c), TestConsole.layer, TestClock.layer(), DateTime.layerCurrentZoneNamed(c.zone)),
    ),
    Effect.provide(NodeServices.layer),
  );

// ---------------------------------------------------------------- the laws

/** One case's row, checked against the oracle. */
const check = (c: Case) =>
  Effect.gen(function* () {
    const got = yield* run(c);
    expect(Exit.isSuccess(got.exit), String(got.exit)).toBe(true);
    expect(got.stdout).toHaveLength(1);
    const want = expected(c);
    // SAFETY: fieldrow prints one JSON object per row; a line that is not an object fails the
    // toEqual against the oracle's row below.
    const row = JSON.parse(got.stdout[0] ?? "") as Record<string, unknown>;
    const { reason: expectedReason, ...wanted } = want;
    const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "why"));
    const written = String(row["why"]);
    expect(fields).toEqual(wanted);
    expect(Object.keys(row)).toEqual(Object.keys(want).map((key) => (key === "reason" ? "why" : key)));
    expect(written).toBe(expectedReason);
  });

/** The cases of the plan's law that a case reaches. */
const reaches = (c: Case): ReadonlyArray<string> => {
  const u = summed(c.lines);
  const profiles = (c.lines ?? []).filter(isProfile);
  const profile = profiles[0];
  const later = profiles[1];
  const profileModel = profile === undefined ? null : profileValue(profile.model);
  const profileEffort = profile === undefined ? null : profileValue(profile.effort);
  const modelValue = c.model.flag ?? (profile === undefined ? c.model.env || null : profileModel);
  const model = modelValue || "unknown";

  const marks: ReadonlyArray<readonly [string, boolean]> = [
    ["no events file", c.lines === null],
    ["no usage", c.lines !== null && u === null],
    ["usage", u !== null],
    ["priced cache", u !== null && u.cached > 0 && LIST.has(model)],
    ["known sol price", model === "gpt-6.1-sol" && u !== null],
    ["known astra price", model === "gpt-6-astra" && u !== null],
    ["prototype model with usage", Object.hasOwn(Object.prototype, model) && u !== null],
    ["prototype model without usage", Object.hasOwn(Object.prototype, model) && u === null],
    ["unknown model with usage", !LIST.has(model) && !Object.hasOwn(Object.prototype, model) && u !== null],
    ["unknown model without usage", !LIST.has(model) && !Object.hasOwn(Object.prototype, model) && u === null],
    ["skipped lines", u !== null && c.lines?.some((line) => line._tag === "skipped") === true],
    ["turns", (c.lines ?? []).filter((line) => line._tag === "turn").length > 1],
    ["file times", c.lines !== null && c.started === null],
    ["given times", c.started !== null],
    ["model from env", profile === undefined && c.model.flag === null && c.model.env !== null],
    ["empty model flag", c.model.flag === ""],
    ["empty model from env", profile === undefined && c.model.flag === null && c.model.env === ""],
    ["empty model with usage", profile === undefined && c.model.flag === null && c.model.env === "" && u !== null],
    ["empty effort flag", c.effort.flag === ""],
    ["empty effort from env", profile === undefined && c.effort.flag === null && c.effort.env === ""],
    [
      "unprofiled model",
      profile === undefined &&
        c.model.flag === null &&
        (c.model.env === null || c.model.env === "") &&
        c.effort.flag === null &&
        (c.effort.env === null || c.effort.env === ""),
    ],
    ["requested profile", profile !== undefined],
    [
      "profile flags override",
      profile !== undefined &&
        ((c.model.flag !== null && c.model.flag !== profileModel) ||
          (c.effort.flag !== null && c.effort.flag !== profileEffort)),
    ],
    [
      "profile beats env",
      profile !== undefined &&
        ((c.model.flag === null && c.model.env !== null && c.model.env !== "" && profileModel !== c.model.env) ||
          (c.effort.flag === null && c.effort.env !== null && c.effort.env !== "" && profileEffort !== c.effort.env)),
    ],
    [
      "profile missing values",
      profile !== undefined &&
        ((c.model.flag === null && profileModel === null) || (c.effort.flag === null && profileEffort === null)),
    ],
    [
      "first profile wins",
      profile !== undefined &&
        later !== undefined &&
        ((c.model.flag === null && profileModel !== profileValue(later.model)) ||
          (c.effort.flag === null && profileEffort !== profileValue(later.effort))),
    ],
    [
      "invalid first profile stays unknown",
      profile !== undefined &&
        later !== undefined &&
        ((c.model.flag === null &&
          profileModel === null &&
          profile.model !== null &&
          profile.model !== undefined &&
          !Predicate.isString(profile.model) &&
          profileValue(later.model) !== null) ||
          (c.effort.flag === null &&
            profileEffort === null &&
            profile.effort !== null &&
            profile.effort !== undefined &&
            !Predicate.isString(profile.effort) &&
            profileValue(later.effort) !== null)),
    ],
    ["step bounds", c.step !== null && c.status !== null],
    ["bounds without step", c.step === null && c.status !== null],
    ["receipt", c.receipt !== null],
  ];

  return marks.flatMap(([mark, hit]) => (hit ? [mark] : []));
};

const REQUIRED = [
  "bounds without step",
  "empty effort flag",
  "empty effort from env",
  "empty model flag",
  "empty model from env",
  "empty model with usage",
  "file times",
  "given times",
  "known astra price",
  "known sol price",
  "first profile wins",
  "invalid first profile stays unknown",
  "model from env",
  "no events file",
  "no usage",
  "priced cache",
  "profile beats env",
  "profile flags override",
  "profile missing values",
  "prototype model with usage",
  "prototype model without usage",
  "requested profile",
  "receipt",
  "skipped lines",
  "step bounds",
  "turns",
  "unprofiled model",
  "usage",
  "unknown model with usage",
  "unknown model without usage",
];

const options = { seed: 119120, numRuns: runsFor({ fast: 100, full: 100 }), endOnFailure: true };

describe("T766 S3 fieldrow.ts prints fieldrow.py's Codex row, today's tooling", () => {
  // Plant: bill `cachedTokens` at the input rate, `(input * in + output * out) / 1e6`.
  it("The Codex row's fields, sums and list price match fieldrow.py's for the same events file", () =>
    fc.assert(
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits the Promise each case hands back
      fc.asyncProperty(cases, (c) => Effect.runPromise(check(c))),
      options,
    ));

  // scenario: the coverage of the law above, one fixed sample. The same generator, seed and count
  // reach every case the law must hold on, or this fails and names the case it never looked at.
  it("scenario: the Codex row law's generator reaches every case the plan names", () => {
    const reached = new Set(fc.sample(cases, { seed: options.seed, numRuns: options.numRuns }).flatMap(reaches));
    expect(REQUIRED.filter((mark) => !reached.has(mark))).toEqual([]);
  });
});
