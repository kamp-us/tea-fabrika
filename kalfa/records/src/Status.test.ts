// L1 of docs/plan/quests/rules-and-records-build-PLAN.md (slice 8, 0606): a decision's status decodes to
// exactly two cases, and every other value is one `status` finding that names the file and line.
//
// Assumed export, `Status.ts`: `decodeStatus(frontmatter: unknown, at: { path: string; line: number }):
// Result<Status, Finding>`, from an object that `yaml` has parsed. Its failure is the `status` case of
// `Finding`, `{ _tag: "status", path, line, raw }`, `raw` being the status as written when it is a string.
//
// Each run builds every valid and invalid shape from its ids, so each case is reached in every run.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Result, Schema } from "effect";
import { Number4, pad } from "./Records.test-support.ts";
import { decodeStatus } from "./Status.ts";

const check = { arbitrary: { seed: 119120, runs: runsFor({ fast: 50, full: 200 }) } };

// Plant: add an `amended` case to `Status`, so the amended shapes decode.
it.prop(
  "L1 a status decodes to accepted, or superseded with a four-digit successor, and every other value is one status finding",
  {
    number: Number4,
    another: Number4,
    line: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 400 })),
    noise: Schema.Boolean,
  },
  ({ number, another, line, noise }) => {
    const id = pad(number);
    const other = pad(another);
    const at = { path: `.decisions/${id}-a-rule.md`, line };
    const keys = noise ? { id, title: "A rule", date: "2026-11-18", tags: ["records"] } : {};
    const decode = (frontmatter: Readonly<Record<string, unknown>>) => decodeStatus({ ...keys, ...frontmatter }, at);

    const accepted = decode({ status: "accepted" });
    expect(Result.isSuccess(accepted) ? accepted.success : accepted.failure).toEqual({ _tag: "accepted" });

    const superseded = decode({ status: "superseded", successor: other });
    expect(Result.isSuccess(superseded) ? superseded.success : superseded.failure).toEqual({
      _tag: "superseded",
      successor: other,
    });

    const link = `[${other}](${other}-a-rule.md)`;

    // Values that are not a status at all: the finding keeps the text as written.
    for (const status of [
      `amended-in-part by ${link}`,
      `amended-in-part by ${link}, [${id}](${id}-b-rule.md)`,
      "proposed",
      `superseded by ${link}`,
      "",
    ]) {
      const result = decode({ status });

      expect(Result.isFailure(result), status).toBe(true);
      expect(Result.isFailure(result) ? result.failure : undefined, status).toMatchObject({
        _tag: "status",
        path: at.path,
        line,
        raw: status,
      });
    }

    // A status word with the wrong successor, and a status that is not text.
    for (const frontmatter of [
      { status: "superseded" },
      { status: "accepted", successor: other },
      { status: "superseded", successor: "162" },
      { status: "superseded", successor: `${other}0` },
      { status: "superseded", successor: "abcd" },
      { status: "superseded", successor: 162 },
      { status: null },
      {},
    ]) {
      const result = decode(frontmatter);

      expect(Result.isFailure(result), JSON.stringify(frontmatter)).toBe(true);
      expect(Result.isFailure(result) ? result.failure : undefined, JSON.stringify(frontmatter)).toMatchObject({
        _tag: "status",
        path: at.path,
        line,
      });
    }
  },
  check,
);
