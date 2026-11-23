// The generator and the routes C10 and T9 run over: slice 3 of ticket 1944. It reuses `GitHub.test-support.ts`'s texts and
// routes; each class of the plan's `fakeCalls` is a value the law reads and checks in every run, so none is left to chance.
import { Arbitrary, Schema } from "effect";
import { between, textVariants, word } from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import { CREATE_ISSUE } from "./Octokit.test-support.ts";

/** Creates an issue and reads back its number and title: a route whose only 2xx is 201 (class V). */
export const CreatedIssue = GitHub.route(CREATE_ISSUE, {
  payload: Schema.Struct({ title: Schema.String }),
  success: Schema.Struct({ number: Schema.Int, title: Schema.String }),
});

/** Creates an issue with a title the caller holds as a number, and reads back the title as text: its payload's decoded type is
 * not its encoded one, and a number written as JSON differs from its text, so a fake that hands `f` the decoded value shows
 * (class Z). */
export const EchoIssue = GitHub.route(CREATE_ISSUE, {
  payload: Schema.Struct({ title: Schema.FiniteFromString }),
  success: Schema.Struct({ title: Schema.String }),
});

/** What one run of C10 is made of. */
interface FakeCall {
  readonly owner: string;
  readonly repo: string;
  /** The text the echoes are built from: every good variant of it is sent, so the marks of (h) and (i) reach `f`. */
  readonly base: string;
  readonly length: number;
  readonly runId: number;
  readonly perPage: number;
  readonly issueNumber: number;
  /** The number the caller holds as a title. */
  readonly millis: number;
  /** A poll interval in milliseconds, never 30 seconds (class Y). */
  readonly pollMillis: number;
  /** A 4xx status, and which of GitHub's error fields the refusal carries. */
  readonly refusal: {
    readonly status: number;
    readonly message: boolean;
    readonly url: boolean;
    readonly errors: boolean;
  };
  readonly said: string;
}

/** The good texts of a base: every variant of the plan's `text` that `call` accepts. */
export const goodTexts = (base: string, length: number): ReadonlyArray<string> =>
  textVariants(base, length)
    .filter((variant) => !variant.refused)
    .map((variant) => variant.value);

/** The calls of C10: a text, ids, a date, a poll interval and a refusal, each drawn, with the plan's classes checked by the law. */
export const fakeCalls: Arbitrary.Arbitrary<FakeCall> = Arbitrary.all({
  owner: word,
  repo: word,
  base: word,
  length: between(0, 100000),
  runId: between(0, 2_000_000_000),
  perPage: between(0, 100),
  issueNumber: between(0, 1_000_000),
  millis: between(0, 4_000_000_000_000),
  poll: between(0, 1_000_000),
  status: between(400, 499),
  parts: between(0, 7),
  said: word,
}).pipe(
  Arbitrary.map(({ poll, status, parts, ...rest }) => ({
    ...rest,
    pollMillis: poll * 2 + 1,
    refusal: { status, message: (parts & 1) !== 0, url: (parts & 2) !== 0, errors: (parts & 4) !== 0 },
  })),
);
