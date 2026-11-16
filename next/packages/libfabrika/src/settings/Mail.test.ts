// Ticket 1041, next/: L4 of the pipe plumbing plan (docs/plan/quests/t1041-PLAN.md), written before
// the build. An inbox's cap and a chunked send's letter size are two repo settings.
//
// The contract this law pins, from the plan's "The two settings" and the lead's calls after
// experiment 295:
//   settings/Declarations.ts: `mailUnread` at `mail.unread`, a whole number from 1 to 16,384, and
//   `mailChunk` at `mail.chunk`, a byte size from 1 KiB to 1 MiB written as text ("64 KiB"), both in
//   `all`, scope `["repo"]`, reload on restart.
import { describe, expect, it } from "@kampus/vitest";
import { ByteSize, Effect, Exit, Result, Schema } from "effect";
import * as fc from "fast-check";
import type { TestContext } from "vitest";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Sources from "./Sources.ts";
import type { TomlDocument } from "./Toml.ts";

const KIB = 1_024;
const MIB = 1_024 * KIB;
/** The cap's bounds: at least one letter, and no more than experiment 295 measured. */
const UNREAD = { least: 1, most: 16_384 };
/** The chunk's bounds: room for a part's own fields, and half the ledger's 2,000,000-byte row. */
const CHUNK = { least: KIB, most: MIB };
/** `catchUp` holds every unread letter at once: a full inbox of full chunks fits one eighth of 128 MB. */
const HELD = 16 * MIB;

const document = (value: TomlDocument["value"] | undefined, path: ReadonlyArray<string>): TomlDocument => ({
  value: value ?? {},
  spans: value === undefined ? [] : [{ path: [...path], line: 3 }],
});

type Source = "default" | "flag" | "env" | "repo" | "person";

/** The four sources the common order reads, each holding `text` for the setting only when `source` is it. */
const slots = (
  source: Source,
  setting: { readonly path: string; readonly env: string; readonly segments: ReadonlyArray<string> },
  file: TomlDocument["value"],
  text: string,
) => ({
  flags: Sources.flags(source === "flag" ? { [setting.path]: text } : {}),
  env: Sources.env(source === "env" ? { [setting.env]: text } : {}),
  repo: Sources.file(".fabrika/fabrika.toml", document(source === "repo" ? file : undefined, setting.segments)),
  person: Sources.file("~/.fabrika/fabrika.toml", document(source === "person" ? file : undefined, setting.segments)),
});

/** A value around a bound: just inside, on it, or just past it. */
const around = (least: number, most: number) =>
  fc.oneof(
    fc.integer({ min: least - 3, max: least + 3 }),
    fc.integer({ min: most - 3, max: most + 3 }),
    fc.integer({ min: least, max: most }),
  );

const Source = fc.constantFrom<Source>("default", "flag", "env", "repo", "person");

/** What each law's cases reached so far, by the law's own task, so each run of a law starts empty. */
const reaches = new WeakMap<object, Set<string>>();

/**
 * The set one law's cases add what they reach to. The first case registers `covers`, which runs once
 * when the law ends, so a walk that reached too little fails loudly however its cases went.
 */
const reach = (ctx: TestContext, covers: (seen: ReadonlyArray<string>) => void): Set<string> => {
  const known = reaches.get(ctx.task);

  if (known !== undefined) {
    return known;
  }

  const seen = new Set<string>();
  reaches.set(ctx.task, seen);
  ctx.onTestFinished(() => covers([...seen]));
  return seen;
};

describe("T1041: the inbox cap and the chunk size are repo settings", () => {
  it.effect.prop(
    "L4: mail.unread and mail.chunk read through their declarations in the common source order, a byte size is written as text, a value out of range fails naming its key, and an empty file gives the default",
    // fast-check kept: moved unchanged from the property runner; the Schema rewrite comes later in 0579's sweep
    { input: fc.tuple(around(UNREAD.least, UNREAD.most), around(CHUNK.least, CHUNK.most), Source, fc.boolean()) },
    ({ input: [unread, chunk, source, unit] }, ctx) => {
      // An empty walk cannot pass: every source, and a refusal of each setting, was reached.
      const reached = reach(ctx, (seen) =>
        expect(seen).toEqual(
          expect.arrayContaining([
            "default",
            "mailUnread_flag",
            "mailUnread_env",
            "mailUnread_repo",
            "mailUnread_person",
            "mailChunk_flag",
            "mailChunk_env",
            "mailChunk_repo",
            "mailChunk_person",
            "mailUnread_refused",
            "mailChunk_refused",
          ]),
        ),
      );
      return Effect.gen(function* () {
        const unreadOk = Number.isInteger(unread) && unread >= UNREAD.least && unread <= UNREAD.most;
        const chunkOk = chunk >= CHUNK.least && chunk <= CHUNK.most;
        // A byte size in a file is text: whole KiB as "N KiB", any other count as "N B".
        const chunkText = unit && chunk % KIB === 0 ? `${chunk / KIB} KiB` : `${chunk} B`;

        for (const [setting, value, text, ok, key] of [
          [Declarations.mailUnread, { mail: { unread } }, String(unread), unreadOk, "mailUnread"],
          [Declarations.mailChunk, { mail: { chunk: chunkText } }, chunkText, chunkOk, "mailChunk"],
        ] as const) {
          const answer = yield* Sources.resolve(Declarations.all, slots(source, setting, value, text)).pipe(
            Effect.exit,
          );
          const read = key === "mailUnread" ? unread : chunk;

          if (source === "default") {
            expect(Exit.isSuccess(answer), `no source holds ${setting.path}: it reads its default`).toBe(true);

            if (Exit.isSuccess(answer)) {
              expect(answer.value.values[key], `${setting.path} with no source is its declared default`).toEqual(
                setting.default,
              );
              expect(answer.value.origins[setting.path]?._tag).toBe("default");
            }

            reached.add("default");
            continue;
          }

          if (!ok) {
            expect(Exit.isFailure(answer), `${setting.path} = ${text} from ${source} is out of range`).toBe(true);

            if (Exit.isFailure(answer)) {
              const failure = answer.cause.reasons.find((r) => r._tag === "Fail");
              expect(failure?._tag === "Fail" && failure.error, "the refusal is a settings error").toBeInstanceOf(
                Files.SettingsError,
              );
              expect(failure?._tag === "Fail" ? failure.error : null).toMatchObject({ reason: "invalid" });
              const message = failure?._tag === "Fail" ? String(failure.error.message) : "";
              expect(message.includes(setting.path), `the refusal names ${setting.path}`).toBe(true);
            }

            reached.add(`${key}_refused`);
            continue;
          }

          expect(Exit.isSuccess(answer), `${setting.path} = ${text} from ${source} is read`).toBe(true);

          if (Exit.isSuccess(answer)) {
            const got = answer.value.values[key];
            expect(
              key === "mailChunk" ? Number(ByteSize.toBigInt(got as ByteSize.ByteSize)) : got,
              `${setting.path} = ${text} from ${source}`,
            ).toBe(read);
            expect(answer.value.origins[setting.path]?._tag, `${setting.path}'s origin`).toBe(
              source === "repo" || source === "person" ? "file" : source,
            );
          }

          reached.add(`${key}_${source}`);
        }

        // Each is a repo setting: a person's file may not hold it, and the repo's file may.
        for (const [path, value] of [
          [Declarations.mailUnread.path, { mail: { unread: UNREAD.least } }],
          [Declarations.mailChunk.path, { mail: { chunk: "64 KiB" } }],
        ] as const) {
          const strict = { onExcessProperty: "error" } as const;
          expect(
            Result.isSuccess(Schema.decodeUnknownResult(Files.schema(Declarations.all, "repo"), strict)(value)),
            `${path} may be set in the repo's file`,
          ).toBe(true);
          expect(
            Result.isFailure(Schema.decodeUnknownResult(Files.schema(Declarations.all, "person"), strict)(value)),
            `${path} may not be set in a person's file`,
          ).toBe(true);
        }
      });
    },
    {
      plant: "mail.unread's schema takes 16385, one past the cap's bound",
      fastCheck: { numRuns: 100, endOnFailure: true },
    },
  );

  // A full inbox of full chunks fits what one catch-up may hold.
  it(
    "T1041 L4 mail.unread and mail.chunk keep their declared defaults and metadata",
    () => {
      expect(Declarations.all.declarations).toEqual(
        expect.arrayContaining([Declarations.mailUnread, Declarations.mailChunk]),
      );
      expect(
        Declarations.mailUnread.default * Number(ByteSize.toBigInt(Declarations.mailChunk.default)),
        "the cap times the chunk size is at most 16 MiB",
      ).toBeLessThanOrEqual(HELD);
      expect(Declarations.mailUnread).toMatchObject({
        path: "mail.unread",
        default: 256,
        scope: ["repo"],
        reload: "restart",
        since: "0.0.0",
      });
      expect(Declarations.mailChunk).toMatchObject({
        path: "mail.chunk",
        format: "text",
        scope: ["repo"],
        reload: "restart",
        since: "0.0.0",
      });
      expect(ByteSize.toBigInt(Declarations.mailChunk.default)).toBe(64n * 1024n);
    },
    {
      format:
        "experiment 295 picked these defaults and the lead took them; the reference page and the generated repo file print them",
    },
  );
});
