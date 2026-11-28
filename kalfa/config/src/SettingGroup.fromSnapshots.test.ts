// Ticket 1845, kalfa/config (new work), slice 2: SN6 to SN10 of the approved plan (.kalfa/quests/kalfa-config-nofiles-PLAN.md),
// for `SettingGroup.layerFromSnapshots` and the receiver behind it (internal/receive.ts), and SN8b, the rule both
// followers share seen from outside. Written before the code.
//
// What the code does, as these laws hold it to (the plan's "A Worker starts from a stream of snapshots"):
// - The layer starts the group on the first item of the stream, read strictly with the closing `<app> did not start.`
//   A stream that ends before an item fails it with `no snapshot came before the stream ended.`
// - Each later item is read with the closing `<app> keeps the last good values.` A refused one is one warning and moves
//   nothing. A taken one is applied by the rule both followers share: each live field gets the new value, each restart
//   value that differs from the last taken is one info line `<name> changed. It applies when <app> starts again.`, with no
//   file name, and a restart field and its origin keep what the start gave.
// - A stream that ends after some items keeps the last values and logs one info line.
// - Each later item runs in a root span `config.update`; the start runs in `config.layer`.
// - The receiver reads no file: the rig gives it no file system, no path, and a configuration provider that dies when asked.
//
// Time is the scheduler's turns: the carrier is a `Queue`, and the digest is the rig's synchronous one.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Effect, Option } from "effect";
import { field } from "./internal/names.ts";
import type { Settled } from "./internal/read.ts";
import {
  apply,
  boot,
  builds,
  capturing,
  close,
  closeInbox,
  collect,
  Draw,
  endInbox,
  feed,
  FIRST,
  firstItem,
  flush,
  forms,
  HiddenDraw,
  heldNow,
  hiding,
  infos,
  initial,
  laters,
  MISFITS,
  type Misfit,
  misfits,
  MOVES,
  type Move,
  openInbox,
  plain,
  Reach,
  receiverGroup,
  refusal,
  refusedFrom,
  restartLine,
  richScene,
  running,
  script,
  sceneFor,
  scriptGroup,
  sealed,
  settledFrom,
  siteFor,
  snapshotFrom,
  warnings,
  watchLive,
  named,
} from "./SettingGroup.snapshot.test-support.ts";

const check = { arbitrary: { runs: runsFor({ fast: 25, full: 100 }), size: 100 } };

const closes = (app: string) => `${app} keeps the last good values.`;

const ended = (app: string) => `the snapshot stream ended. A change applies when ${app} starts again.`;

const WINDOW = "config.watch.debounce";

/** The distinct consecutive values of a list, as a person reads a `changes` stream. */
const distinct = (values: ReadonlyArray<unknown>): ReadonlyArray<unknown> =>
  values.filter((value, n) => n === 0 || JSON.stringify(value) !== JSON.stringify(values[n - 1]));

/** What a running receiver shows after `last` was taken and `start` was the first taken: a live field and its origin follow the last, a restart one keeps the start's. */
const expected = (start: ReadonlyArray<Settled>, last: ReadonlyArray<Settled>) => ({
  values: Object.fromEntries(
    last.flatMap(({ setting, value }, i) =>
      setting.name === WINDOW ? [] : [[field(setting.name), setting.live ? value : start[i]?.value] as const],
    ),
  ),
  origins: Object.fromEntries(
    last.map(({ setting, origin }, i) => [setting.name, setting.live ? origin : start[i]?.origin]),
  ),
});

/** The restart lines a change from `before` to `after` is owed, in the group's order. */
const owed = (app: string, before: ReadonlyArray<Settled>, after: ReadonlyArray<Settled>) =>
  after.flatMap(({ setting, value }, i) =>
    !setting.live && JSON.stringify(before[i]?.value) !== JSON.stringify(value) ? [restartLine(app, setting.name)] : [],
  );

// ---------------------------------------------------------------------------------------------
// SN6, the receiver starts on the first item and follows
// ---------------------------------------------------------------------------------------------

// Plants: (i) set a restart value from a later snapshot too: red; (i) keep the first's origins for live settings: red;
// (j) compare a restart value with the first snapshot, not the last taken: a value that stays logs again and one that
// goes back logs nothing, red; (k) end the fold on a refused item: the next good one is not taken, red; (m) hand
// `typed` another group in `layerFromSnapshots`: the receiver's own `snapshots` gives another app or other values, red.
it.effect.prop(
  "SN6 the receiver starts on the first item and follows: after each later item each live field yields the last taken value and its `changes` gave the distinct taken values, each restart field reads the first's value, the origins follow a live setting and keep a restart setting's first, each restart value that differs from the last taken logs one line, each refused item logs one warning and moves nothing, and `snapshots` gives the last taken",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Move>(MOVES);
      const group = receiverGroup(draw);
      const first = FIRST(draw);
      const start = settledFrom(draw, group, first);

      const inbox = yield* openInbox(group, [yield* snapshotFrom(draw, group, first)]);
      const seen = yield* watchLive(inbox);

      expect(yield* running(inbox), "the layer builds on the first item").toEqual(expected(start, start));
      expect(infos(inbox.capture), "no line at the start").toEqual([]);

      let frame = first;
      let last = start;
      const takens = [start];

      for (const later of laters(draw)) {
        const input =
          later.frame === undefined
            ? yield* refusedFrom(draw, yield* snapshotFrom(draw, group, frame))
            : yield* snapshotFrom(draw, group, later.frame);

        const marks = { infos: infos(inbox.capture).length, warnings: warnings(inbox.capture).length };
        yield* feed(inbox, input);

        const nextFrame = later.frame ?? frame;
        const next = settledFrom(draw, group, nextFrame);
        const label = `after the ${later.id} item`;

        expect(yield* running(inbox), label).toEqual(expected(start, next));
        expect(infos(inbox.capture).slice(marks.infos), `${label}: the restart lines`).toEqual(
          owed(draw.app, last, next),
        );

        const warned = warnings(inbox.capture).slice(marks.warnings);

        if (later.frame === undefined) {
          expect(warned, `${label}: one warning`).toHaveLength(1);
          expect(warned[0]?.endsWith(closes(draw.app)), `${label}: the warning ends with the closing`).toBe(true);
        } else {
          expect(warned, `${label}: no warning`).toEqual([]);
          takens.push(next);
        }

        // The receiver re-offers what it took, whole: the app, the values, the origins and the hash.
        expect(yield* heldNow(inbox), `${label}: snapshots gives the last taken`).toEqual(
          yield* snapshotFrom(draw, group, nextFrame),
        );

        frame = nextFrame;
        last = next;
        reach.mark(later.id);
      }

      for (const [n, { setting }] of start.entries()) {
        if (setting.live) {
          expect(seen[field(setting.name)], `${setting.name}: what \`changes\` gave`).toEqual(
            distinct(takens.map((taken) => taken[n]?.value)),
          );
        }
      }

      yield* closeInbox(inbox);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN7, the first item and the stream's end
// ---------------------------------------------------------------------------------------------

type Ending = "empty" | "ended" | Misfit;

const ENDINGS: ReadonlyArray<Ending> = ["empty", "ended", ...MISFITS];

// Plants: (l) start on the defaults when no item comes: red; (l) log a refused first item and wait for the next: the
// layer never builds, and the law is red (a refused first item must fail it, so the exit is a success or never comes).
it.effect.prop(
  "SN7 the first item and the stream's end: a stream that ends before an item fails the layer with one reason snapshot error and the closing it did not start with, a first item of each misfit class fails it with the strict read's message and that closing, and a stream that ends after some items keeps the last values and logs one line",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Ending>(ENDINGS);
      const closing = `${draw.app} did not start.`;

      // The stream ends before an item.
      const group = receiverGroup(draw);
      const nothing = refusal(yield* Effect.exit(openInbox(group, [], { ending: true })));

      expect(nothing.reason).toBe("snapshot");
      expect(
        nothing.place,
        "no place: the stream ended before a snapshot, and no file, variable or flag is at fault",
      ).toBeUndefined();
      expect(nothing.message).toBe(`no snapshot came before the stream ended.\n  ${closing}`);
      reach.mark("empty");

      // A first item of each misfit class: the strict read's message, with this closing.
      const rig = yield* boot(richScene(draw));
      const item = yield* firstItem(rig);

      for (const one of yield* misfits(draw, item, yield* builds(draw))) {
        const found = refusal(yield* Effect.exit(openInbox(rig.group, [one.input])));

        expect(found.reason, `${one.id} ${one.label}`).toBe("snapshot");
        expect(found.place, `${one.id}: no place`).toBeUndefined();
        expect(found.message, `${one.id} ${one.label}`).toBe(`${one.message}\n  ${closing}`);
        reach.mark(one.id);
      }

      yield* close(rig);

      // The stream ends after some items: the last values hold, and one line says so.
      const first = FIRST(draw);
      const [live] = laters(draw);
      const frame = live?.frame ?? first;
      const target = settledFrom(draw, group, frame);

      const inbox = yield* openInbox(
        group,
        [yield* snapshotFrom(draw, group, first), yield* snapshotFrom(draw, group, frame)],
        { ending: true },
      );

      yield* endInbox(inbox);

      expect(yield* running(inbox), "the last values hold").toEqual(expected(settledFrom(draw, group, first), target));
      expect(infos(inbox.capture), "one line").toEqual([ended(draw.app)]);
      expect(warnings(inbox.capture), "no warning").toEqual([]);
      expect(yield* heldNow(inbox), "snapshots holds the last").toEqual(yield* snapshotFrom(draw, group, frame));
      yield* closeInbox(inbox);
      reach.mark("ended");

      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN9, logs and spans keep values out
// ---------------------------------------------------------------------------------------------

type Place = "1" | "2" | "3" | "4" | "5" | "6" | "restart";

const PLACES: ReadonlyArray<Place> = ["1", "2", "3", "4", "5", "6", "restart"];

const PLACE: Readonly<Record<number, Place>> = { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" };

// Plants: (x) put the new value in the restart line: red; (x) annotate the warning with the refused snapshot: red.
it.effect.prop(
  "SN9 [secrets] logs and spans keep values out: a secret in a snapshot refused at each step, and as a restart value that changes, never appears in a log line, its annotations or a span's attributes, raw, escaped or encoded",
  { input: HiddenDraw },
  ({ input: { draw, secret } }) =>
    Effect.gen(function* () {
      const reach = new Reach<Place>(PLACES);
      const rig = yield* boot(richScene(draw));
      const item = yield* firstItem(rig);
      const base = plain(item);
      const text = named(draw.c);

      const inbox = yield* openInbox(rig.group, [item]);

      for (const one of yield* hiding(draw, item, secret)) {
        const marks = warnings(inbox.capture).length;

        yield* feed(inbox, one.input);

        expect(warnings(inbox.capture).length - marks, `${one.label}: one warning`).toBe(1);
        reach.mark(PLACE[one.step] ?? "restart");
      }

      // A restart value that changes: the text setting takes the secret.
      const marks = infos(inbox.capture).length;

      yield* feed(inbox, yield* sealed({ ...base, values: { ...base.values, [text]: secret } }));

      expect(infos(inbox.capture).slice(marks), "the restart line names the setting").toEqual([
        restartLine(draw.app, text),
      ]);
      reach.mark("restart");

      const spans = inbox.capture.spans.map((span) =>
        JSON.stringify([span.name, [...span.attributes], span.events.map((event) => event[0])]),
      );

      expect(spans.length, "the spans were captured").toBeGreaterThan(0);

      for (const form of forms(secret)) {
        for (const line of inbox.capture.logs) {
          expect(line.raw, `a log line holds no ${form}`).not.toContain(form);
        }

        for (const span of spans) {
          expect(span, `a span holds no ${form}`).not.toContain(form);
        }
      }

      yield* closeInbox(inbox);
      yield* close(rig);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN10, spans
// ---------------------------------------------------------------------------------------------

// Plants: (k) mark every update refused false: red; (i) open the update span as a child of the layer's: it is not a
// root, red.
it.effect.prop(
  "SN10 each later item ends one root config.update span with the app, whether it was refused and the reason when refused, and no file, and the start runs in config.layer with the app",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Move>(MOVES);
      const group = receiverGroup(draw);
      const first = FIRST(draw);
      const inbox = yield* openInbox(group, [yield* snapshotFrom(draw, group, first)]);

      const layers = inbox.capture.spans.filter((span) => span.name === "config.layer");

      expect(layers, "one span for the start").toHaveLength(1);
      expect(layers[0]?.status._tag).toBe("Ended");
      expect(layers[0]?.attributes.get("kalfa.config.app")).toBe(draw.app);

      let frame = first;

      for (const later of laters(draw)) {
        const marks = inbox.capture.spans.filter((span) => span.name === "config.update").length;

        const input =
          later.frame === undefined
            ? yield* refusedFrom(draw, yield* snapshotFrom(draw, group, frame))
            : yield* snapshotFrom(draw, group, later.frame);

        yield* feed(inbox, input);

        const made = inbox.capture.spans.filter((span) => span.name === "config.update").slice(marks);

        expect(made, `the ${later.id} item: one span`).toHaveLength(1);

        const [span] = made;

        expect(span?.status._tag, "ended").toBe("Ended");
        expect(Option.isNone(span?.parent ?? Option.some(undefined)), "a root span").toBe(true);
        expect(span?.attributes.get("kalfa.config.app")).toBe(draw.app);
        expect(span?.attributes.has("kalfa.config.file"), "no file was read").toBe(false);
        expect(span?.attributes.get("kalfa.config.refused")).toBe(later.frame === undefined);
        expect(span?.attributes.get("kalfa.config.reason")).toBe(later.frame === undefined ? "snapshot" : undefined);

        frame = later.frame ?? frame;
        reach.mark(later.id);
      }

      yield* closeInbox(inbox);
      reach.done();
    }),
  check,
);

// ---------------------------------------------------------------------------------------------
// SN8b, the two followers give one answer
// ---------------------------------------------------------------------------------------------

type Change = "d" | "e" | "f" | "g" | "h";

// Plants: (p) the receiver opens its restart line with a name no file has: red; (p) the file follower applies a taken
// list against itself: its live values never move, red; (p) the receiver keeps a live origin at the start's: red.
it.effect.prop(
  "SN8b the two followers give one answer: a file follower and a receiver fed the snapshots it gives show the same live values, restart values and origins, and the same restart lines but for the file name, after every change",
  { draw: Draw },
  ({ draw }) =>
    Effect.gen(function* () {
      const reach = new Reach<Change>(["d", "e", "f", "g", "h"]);
      const site = siteFor(draw.app, false);
      const group = scriptGroup(draw);

      let layouts = initial(draw);
      const capture = capturing();
      const rig = yield* boot(sceneFor(draw, layouts), capture);
      const items = yield* collect(rig);
      const inbox = yield* openInbox(group, [items[0]]);
      let fed = 1;

      const own = (lines: ReadonlyArray<string>) =>
        lines.filter((line) => line.endsWith(`when ${draw.app} starts again.`));

      for (const step of script(draw)) {
        const made = apply(draw, layouts, step);
        layouts = made.layouts;

        const marks = own(infos(capture)).length;
        const mine = own(infos(inbox.capture)).length;

        yield* rig.disk.write(site[made.file].path, made.text);
        yield* flush(rig);

        for (const item of items.slice(fed)) {
          yield* feed(inbox, item);
        }

        fed = items.length;

        const label = `after a change of class ${step.change}`;
        const theirs = yield* running(inbox);
        const file = yield* running(rig);

        expect(theirs.values, `${label}: the values`).toEqual(file.values);
        expect(theirs.origins, `${label}: the origins`).toEqual(file.origins);
        expect(own(infos(inbox.capture)).slice(mine), `${label}: the restart lines, the file's name left out`).toEqual(
          own(infos(capture))
            .slice(marks)
            .map((line) => line.replace(/^[^:]*: /u, "")),
        );
        reach.mark(step.change);
      }

      yield* closeInbox(inbox);
      yield* close(rig);
      reach.done();
    }),
  check,
);
