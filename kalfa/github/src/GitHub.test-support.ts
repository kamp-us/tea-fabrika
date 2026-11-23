// What the laws of `GitHub.call` share: the recording stand-in for `send`, the recording tracer, the operations the laws
// call, and the generators. Each law applies, to each value it draws, one made from it for every class of odd value, so
// every case a law must reach is in every run and no run can pass on less.
import {
  Arbitrary,
  Array as Arr,
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
  SchemaGetter,
  Tracer,
} from "effect";
import * as GitHub from "./GitHub.ts";
import {
  CANCEL,
  CHECK_RUNS,
  CREATE_ISSUE,
  DELETE_COMMENT,
  DISPATCH,
  GET_REPO,
  INSTALLATION_TOKEN,
  README,
  STAR,
  UPDATE_ISSUE,
  ZEN,
} from "./Octokit.test-support.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

// ---- the small tools the generators are built from

/** A whole number from `minimum` to `maximum`. */
export const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** One of the choices. */
const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

// ---- the stand-in for `send`, and what it saw

/** The requests the stand-in has been handed, in order. */
class Seen extends Context.Service<Seen, { readonly requests: Effect.Effect<ReadonlyArray<GitHub.Request>> }>()(
  "@kalfa/github/test/Seen",
) {}

/** The stand-in's poll interval: the service's other member, which no law of `call` reads. */
const POLL = Duration.seconds(30);

/** A Layer for `GitHub` whose `send` records each request and answers with `reply`'s value. */
const standIn = (reply: (request: GitHub.Request) => GitHub.Reply): Layer.Layer<GitHub.GitHub | Seen> =>
  Layer.effectContext(
    Effect.map(Ref.make<ReadonlyArray<GitHub.Request>>([]), (seen) =>
      Context.make(GitHub.GitHub, {
        send: (request) => Ref.update(seen, Arr.append(request)).pipe(Effect.as(reply(request))),
        poll: POLL,
      }).pipe(Context.add(Seen, { requests: Ref.get(seen) })),
    ),
  );

/** A value that is JSON, or has an `undefined` where a key or an item was left out. */
type Tree = undefined | null | boolean | number | string | ReadonlyArray<Tree> | { readonly [key: string]: Tree };

/** A reply with a JSON body: `value` written as text, `status` 200 unless given. */
export const json = (value: Tree, status = 200): GitHub.Reply => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(value),
});

/** A reply with a body that is already text. */
export const text = (body: string, status = 200): GitHub.Reply => ({ status, headers: {}, body });

// A tracer that keeps every span it hands out, over the one the test runs under.
const watching = Effect.gen(function* () {
  const delegate = yield* Tracer.Tracer;
  const spans: Array<Tracer.Span> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = delegate.span(options);
      spans.push(span);

      return span;
    },
  });

  return { spans, tracer };
});

/** What one run of a program did under the stand-in: how it ended, what was sent, and every span it made. */
interface Observed<A, E> {
  readonly exit: Exit.Exit<A, E>;
  readonly requests: ReadonlyArray<GitHub.Request>;
  readonly spans: ReadonlyArray<Tracer.Span>;
}

/** Runs `program` under a fresh stand-in answering with `reply`, and reads back what happened. */
export const observed = <A, E, R>(
  program: Effect.Effect<A, E, R>,
  reply: (request: GitHub.Request) => GitHub.Reply,
): Effect.Effect<Observed<A, E>, never, Exclude<R, GitHub.GitHub | Seen>> =>
  Effect.gen(function* () {
    const { spans, tracer } = yield* watching;

    const { exit, requests } = yield* program.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.map(
          Seen.use((seen) => seen.requests),
          (requests) => ({ exit, requests }),
        ),
      ),
      Effect.withTracer(tracer),
      Effect.provide(standIn(reply)),
    );

    return { exit, requests, spans };
  });

// ---- the operations the laws call: each is declared as a caller declares it, in GitHub's own route text

const Status = Schema.Literals(["queued", "in_progress", "completed"]);

/** The part of a check run a caller reads. */
const CheckRun = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  status: Status,
  conclusion: Schema.NullOr(Schema.Literals(["success", "failure", "cancelled"])),
});

/** The check runs of a commit, with the query a caller sets some of. */
export const ListCheckRuns = GitHub.route(CHECK_RUNS, {
  query: {
    per_page: Schema.Int,
    status: Schema.optionalKey(Status),
    check_name: Schema.optional(Schema.String),
    filter: Schema.optionalKey(Schema.Literals(["latest", "all"])),
  },
  success: Schema.Struct({ check_runs: Schema.Array(CheckRun) }),
});

/** Cancels a run: a path name that is a number, and a bare 202. */
export const CancelRun = GitHub.route(CANCEL, { success: Schema.Struct({}) });

/** The same route with nothing declared to read: its answer is `void`. */
export const CancelRunUnread = GitHub.route(CANCEL);

/** A list of notifications: a boolean and a number in the query, and nothing to read. */
export const ListNotifications = GitHub.route("GET /notifications", {
  query: { all: Schema.optionalKey(Schema.Boolean), per_page: Schema.optionalKey(Schema.Int) },
});

/** A list of migrations: an array in the query. */
export const ListMigrations = GitHub.route("GET /orgs/{org}/migrations", {
  query: { exclude: Schema.optionalKey(Schema.Array(Schema.Literals(["repositories"]))) },
});

/** The payload of an issue, with each kind of left-out and falsy value at the top and below. */
export const IssuePayload = Schema.Struct({
  title: Schema.String,
  body: Schema.optional(Schema.String),
  assignee: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // The milestone is a `Schema.Number`, which takes NaN and Infinity, so the law that sends them reaches the JSON check.
  // @effect-diagnostics-next-line schemaNumber:off -- NaN and Infinity must reach the JSON check
  milestone: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  labels: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        color: Schema.optional(Schema.String),
        description: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  assignees: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Creates an issue. */
export const CreateIssue = GitHub.route(CREATE_ISSUE, { payload: IssuePayload });

/** The payload of an installation token: nested optional keys. */
export const TokenPayload = Schema.Struct({
  repositories: Schema.optionalKey(Schema.Array(Schema.String)),
  repository_ids: Schema.optionalKey(Schema.Array(Schema.Int)),
  permissions: Schema.optional(
    Schema.Struct({
      issues: Schema.optional(Schema.Literals(["read", "write"])),
      contents: Schema.optionalKey(Schema.Literals(["read", "write"])),
    }),
  ),
});

/** Makes an installation token: an answer whose decoded type is not its encoded one. */
export const MakeToken = GitHub.route(INSTALLATION_TOKEN, {
  payload: TokenPayload,
  success: Schema.Struct({ token: Schema.String, expires_at: Schema.DateTimeUtcFromString }),
});

/** The payload of a dispatch: free keys under `inputs`. */
export const DispatchPayload = Schema.Struct({
  ref: Schema.String,
  inputs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  return_run_details: Schema.optionalKey(Schema.Boolean),
});

/** Dispatches a workflow: a 204 with no body beside a 200 with one. */
export const Dispatch = GitHub.route(DISPATCH, {
  payload: DispatchPayload,
  success: Schema.Struct({ workflow_run_id: Schema.Int, run_url: Schema.String }),
  bodiless: [204],
});

/** The same route with no answer declared: it answers `void` under either status. */
export const DispatchUnread = GitHub.route(DISPATCH, {
  payload: Schema.Struct({ ref: Schema.String }),
  bodiless: [204],
});

// ---- what an exit holds

/** The typed failure an exit holds, when it failed with one and died of nothing. */
export const failure = <A, E>(exit: Exit.Exit<A, E>): E | undefined =>
  Exit.isFailure(exit) && !Cause.hasDies(exit.cause)
    ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
    : undefined;

/** The reason inside a `GitHubError`, and the route text it names: `undefined` for any other failure. */
export const reasonHeld = <A>(
  exit: Exit.Exit<A, GitHub.GitHubError | GitHub.RateLimited>,
): { readonly operation: string; readonly reason: GitHub.GitHubError["reason"] } | undefined => {
  const held = failure(exit);

  return Predicate.isTagged(held, "GitHubError") ? { operation: held.operation, reason: held.reason } : undefined;
};

/** An `Undecodable` input refusal of `route`: the reason an exit holds when `call` refused before it sent. */
export const refusedInput = <A>(
  exit: Exit.Exit<A, GitHub.GitHubError | GitHub.RateLimited>,
  route: string,
): boolean => {
  const found = reasonHeld(exit);

  return found?.operation === route && Predicate.isTagged(found.reason, "Undecodable") && found.reason.side === "input";
};

// ---- text

// The pieces a drawn word is built from: letters past ASCII, marks a URL or a template treats, and a space.
const PIECES = [
  "a",
  "B",
  "7",
  "-",
  "_",
  "é",
  "ş",
  "İ",
  "设",
  "�",
  "😀",
  "%",
  "?",
  "#",
  " ",
  "\t",
  "~",
  "!",
  "'",
  "(",
  ")",
  "*",
  '"',
  "\\",
  "[",
  "]",
  "{",
  "}",
  "$",
  "<",
  "|",
] as const;

/** A good text: it starts with a letter, so it is not empty, blank, `.` or `..`, and it holds no lone surrogate. */
export const word: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(["a", "Z", "q", "7", "x"]),
  rest: Arbitrary.array(pick(PIECES), { maxLength: 6 }),
}).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

/** A text made from `word` for one class of the plan's `text` generator, and whether `call` must refuse it. */
interface Variant {
  readonly name: string;
  readonly value: string;
  readonly refused: boolean;
}

const good = (name: string, value: string): Variant => ({ name, value, refused: false });

const refused = (name: string, value: string): Variant => ({ name, value, refused: true });

/**
 * A text for each class: (a) empty, one space, only spaces; (b) padding; (c) slashes; (d) marks of a URL; (e) `.` and `..`
 * alone, and inside; (f) letters past ASCII and past the Basic Multilingual Plane, and the lone surrogates; (g) control
 * marks; (h) JSON and template marks; (i) names an object holds; (j) 256 to 4,000 characters. `word` is a good text.
 */
export const textVariants = (base: string, length: number): ReadonlyArray<Variant> => [
  refused("a: empty", ""),
  refused("a: one space", " "),
  refused("a: only spaces", " ".repeat(2 + (length % 7))),
  good("b: space around", ` ${base} `),
  good("b: tab", `\t${base}\t`),
  good("b: line feed", `\n${base}`),
  good("b: carriage return and line feed", `${base}\r\n`),
  good("c: a slash alone", "/"),
  good("c: a slash first", `/${base}`),
  good("c: a slash inside", `a/${base}/b`),
  good("c: a slash last", `${base}/`),
  good("d: a percent", "%"),
  good("d: an encoded slash", "%2F"),
  good("d: an encoded dot pair", "%2e%2e"),
  good("d: a question mark", `${base}?x=1`),
  good("d: a fragment", `#${base}`),
  good("d: marks of a query", "&=+;@:"),
  good("d: a space inside", `${base} ${base}`),
  refused("e: a dot alone", "."),
  refused("e: two dots alone", ".."),
  good("e: two dots inside", `a..${base}`),
  good("e: a leading dot", `.${base}`),
  good("e: a trailing dot", `${base}.`),
  good("f: letters past ASCII", "éşİ"),
  good("f: past U+024F", "设�"),
  good("f: outside the Basic Multilingual Plane", `${base}😀`),
  refused("f: a high surrogate alone", "\uD800"),
  refused("f: a low surrogate alone", "\uDC00"),
  refused("f: a high surrogate inside", `${base}\uD800${base}`),
  good("g: a null character", `${base}\u0000`),
  good("g: a unit separator and a delete", `\u001F${base}\u007F`),
  good("g: a line separator", `${base} `),
  good("h: a quote and a backslash", `"${base}\\`),
  good("h: braces and brackets", "{}[]"),
  good("h: another name of the route", "{repo}"),
  good("h: the same name", "{ref}"),
  good("i: __proto__", "__proto__"),
  good("i: constructor", "constructor"),
  good("i: toString", "toString"),
  good("j: long", base.repeat(Math.ceil((256 + (length % 3745)) / base.length))),
];

// ---- numbers a path name takes

/** The whole numbers a path name takes, and the numbers it refuses. */
export const NUMBERS: ReadonlyArray<{ readonly name: string; readonly value: number; readonly refused: boolean }> = [
  { name: "k: zero", value: 0, refused: false },
  { name: "k: one", value: 1, refused: false },
  { name: "k: the largest safe integer", value: Number.MAX_SAFE_INTEGER, refused: false },
  { name: "k: a fraction", value: -1.5, refused: true },
  { name: "k: NaN", value: Number.NaN, refused: true },
  { name: "k: Infinity", value: Number.POSITIVE_INFINITY, refused: true },
  { name: "k: negative Infinity", value: Number.NEGATIVE_INFINITY, refused: true },
  { name: "k: negative zero", value: -0, refused: true },
];

// ---- what the laws read the Request and the body against

/** A copy of an encoded value with every object key whose value is `undefined` left out, at any depth. */
const prune = (value: Tree): Tree =>
  Array.isArray(value)
    ? value.map(prune)
    : Predicate.isObject(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, each]) => each !== undefined)
            .map(([key, each]) => [key, prune(each)]),
        )
      : value;

/** What `call` must send of `value`: its encoded form with the keys that were left out removed. */
// SAFETY: every payload Schema the laws send holds plain fields, so its encoded form is a tree of plain values.
export const sent = <A, I>(schema: Schema.Codec<A, I>, value: A): Tree =>
  prune(Schema.encodeSync(schema)(value) as Tree);

/** Whether an `undefined` stands anywhere in a value, as an object value or an array item. */
export const holdsUndefined = (value: Tree): boolean =>
  value === undefined ||
  (Array.isArray(value)
    ? value.some(holdsUndefined)
    : Predicate.isObject(value) && Object.values(value).some(holdsUndefined));

// ---- the answers

/** The statuses of a check run a caller reads. */
export const STATUSES = ["queued", "in_progress", "completed"] as const;

/** The conclusions a caller reads, and `null` for a run that has none. */
const CONCLUSIONS = [null, "success", "failure", "cancelled"] as const;

/** One check run, as GitHub sends it: the fields a caller reads, and more at every level. */
type RunJson = {
  readonly id: number;
  readonly name: string;
  readonly status: (typeof STATUSES)[number];
  readonly conclusion: (typeof CONCLUSIONS)[number];
  readonly head_sha: string;
  readonly app: { readonly id: number; readonly slug: string; readonly more: { readonly deep: ReadonlyArray<number> } };
};

/** A check run: its id from zero, one and the largest safe integer as often as from the whole range (E). */
const run: Arbitrary.Arbitrary<RunJson> = Arbitrary.all({
  idKind: between(0, 3),
  id: between(0, 2_000_000_000),
  name: word,
  status: pick(STATUSES),
  conclusion: pick(CONCLUSIONS),
  head_sha: word,
  slug: word,
}).pipe(
  Arbitrary.map(({ idKind, id, name, status, conclusion, head_sha, slug }) => ({
    id: [0, 1, Number.MAX_SAFE_INTEGER, id][idKind] ?? id,
    name,
    status,
    conclusion,
    head_sha,
    app: { id, slug, more: { deep: [id, 1] } },
  })),
);

/** The runs of an answer: none, one, or up to fifty (C). */
export const runs: Arbitrary.Arbitrary<ReadonlyArray<RunJson>> = Arbitrary.array(run, { maxLength: 50 });

/** The answer GitHub sends for `list`, with a key the caller does not read at the top and in each run (A). */
export const answerBody = (list: ReadonlyArray<RunJson>) => ({
  total_count: list.length,
  check_runs: list,
  unread: { nested: { value: 1 } },
});

/** What the caller's Schema reads of the answer: the fields it declares and no more. */
export const readBody = (list: ReadonlyArray<RunJson>) => ({
  check_runs: list.map(({ id, name, status, conclusion }) => ({ id, name, status, conclusion })),
});

/** Every way the same value is printed as JSON: compact, pretty, and with every mark past ASCII written `\u`. */
export const printings = (value: Tree): ReadonlyArray<{ readonly name: string; readonly body: string }> => [
  { name: "compact", body: JSON.stringify(value) },
  { name: "pretty", body: JSON.stringify(value, null, 2) },
  {
    name: "escaped",
    body: JSON.stringify(value)
      .replace(/\//g, "\\/")
      .replace(/[\u007f-\uffff]/g, (mark) => `\\u${mark.charCodeAt(0).toString(16).padStart(4, "0")}`),
  },
];

// ---- the answers that cannot be read, and the 4xx bodies

// ---- Schemas that may be async, or need a service

/** A service the caller's Schemas below need to run. */
export class Shouter extends Context.Service<Shouter, { readonly shout: (text: string) => Effect.Effect<string> }>()(
  "@kalfa/github/test/Shouter",
) {}

/** The text the service makes of one it is handed: the one change a transformation below makes. */
export const shout = (text: string): string => `${text.toUpperCase()}!`;

/** A text that is changed by the service in both directions, after a yield: a transformation that cannot run synchronously. */
const Shouted = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((text: string) =>
      Effect.yieldNow.pipe(Effect.andThen(Shouter.use((service) => service.shout(text)))),
    ),
    encode: SchemaGetter.transformEffect((text: string) =>
      Effect.yieldNow.pipe(Effect.andThen(Shouter.use((service) => service.shout(text)))),
    ),
  }),
);

/** The check runs route with a query value, a payload value and an answer value that each pass through the service. */
export const ShoutedRuns = GitHub.route(CHECK_RUNS, {
  query: { per_page: Schema.Int, check_name: Shouted },
  success: Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Int, name: Shouted })) }),
});

/** The check runs route with the service in its query only. */
export const ShoutedQuery = GitHub.route(CHECK_RUNS, { query: { per_page: Schema.Int, check_name: Shouted } });

/** The check runs route with the service in its answer only: a success Schema whose decoding needs a service. */
export const ShoutedAnswer = GitHub.route(CHECK_RUNS, {
  success: Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Int, name: Shouted })) }),
});

/** An issue whose title passes through the service. */
export const ShoutedIssue = GitHub.route(CREATE_ISSUE, { payload: Schema.Struct({ title: Shouted }) });

/** An issue a caller's filters refuse in some values: an integer milestone, and a title that is not empty. */
export const FilteredIssue = GitHub.route(CREATE_ISSUE, {
  payload: Schema.Struct({
    title: Schema.String.check(Schema.isMinLength(1)),
    milestone: Schema.optionalKey(Schema.Int),
  }),
});

/** A value a caller's type would refuse, passed on as the type asks, so a law can reach what only a cast reaches. */
export const untyped = Schema.decodeUnknownSync(Schema.Any);

// ---- 1945, slice 1: text answers, who a request is sent as, a 5xx and a query a URL cannot carry

/** A plain read: the part of a repository a caller reads. */
export const GetRepo = GitHub.route(GET_REPO, {
  success: Schema.Struct({ id: Schema.Int, full_name: Schema.String, private: Schema.Boolean }),
});

/** GitHub answers `/zen` in text, and it is read with no token. */
export const Zen = GitHub.route(ZEN, { body: "text", auth: "none", success: Schema.String });

/** The same text route, sent as the login: the one a call's own token may go with. */
export const ZenAsLogin = GitHub.route(ZEN, { body: "text", success: Schema.String });

/** The same text route with nothing declared to read: its answer is `void`. */
export const ZenUnread = GitHub.route(ZEN, { body: "text", auth: "none" });

/** A text answer read into a Struct: its Schema starts at a string and ends at an object. */
export const ZenCounted = GitHub.route(ZEN, {
  body: "text",
  success: Schema.String.pipe(
    Schema.decodeTo(Schema.Struct({ text: Schema.String, length: Schema.Int }), {
      decode: SchemaGetter.transform((text: string) => ({ text, length: text.length })),
      encode: SchemaGetter.transform((counted: { readonly text: string }) => counted.text),
    }),
  ),
});

/** A file's text, asked for by media type: a route whose answer is JSON until the media type says otherwise. */
export const Readme = GitHub.route(README, {
  body: "text",
  accept: "application/vnd.github.raw+json",
  success: Schema.String,
});

/** The check runs route with a query whose value is read as is, so a value a URL cannot carry reaches the check. */
export const LooseQuery = GitHub.route(CHECK_RUNS, { query: untyped({ per_page: Schema.Unknown }) });

const StarRepo = GitHub.route(STAR);

const PatchIssue = GitHub.route(UPDATE_ISSUE);

const DeleteComment = GitHub.route(DELETE_COMMENT);

/** The five methods, each with a call of a route that has it: the same 5xx is a write that may have applied, or a read. */
export const METHOD_CALLS: ReadonlyArray<{
  readonly method: GitHub.Method;
  readonly program: Effect.Effect<unknown, GitHub.GitHubError | GitHub.RateLimited, GitHub.GitHub>;
}> = [
  { method: "GET", program: GitHub.call(GetRepo, { params: { owner: "o", repo: "r" } }) },
  { method: "PUT", program: GitHub.call(StarRepo, { params: { owner: "o", repo: "r" } }) },
  { method: "POST", program: GitHub.call(CreateIssue, { params: { owner: "o", repo: "r" }, payload: { title: "t" } }) },
  { method: "PATCH", program: GitHub.call(PatchIssue, { params: { owner: "o", repo: "r", issue_number: 1 } }) },
  { method: "DELETE", program: GitHub.call(DeleteComment, { params: { owner: "o", repo: "r", comment_id: 1 } }) },
];

/** The texts a text answer holds: each class of the plan's `texts`, made from one drawn word and its length. */
export const textAnswers = (
  base: string,
  length: number,
): ReadonlyArray<{ readonly name: string; readonly value: string }> => [
  { name: "a: empty", value: "" },
  { name: "a: only spaces", value: "   " },
  { name: "a: a trailing line feed", value: `${base}\n` },
  { name: "a: a carriage return and line feed inside", value: `${base}\r\n${base}` },
  { name: "b: an empty object", value: "{}" },
  { name: "b: an empty list", value: "[]" },
  { name: "b: null", value: "null" },
  { name: "b: a number", value: "123" },
  { name: "b: a quoted text", value: '"x"' },
  { name: "b: true", value: "true" },
  { name: "c: a quote and a backslash", value: `"${base}\\` },
  { name: "c: control marks", value: Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join("") },
  { name: "c: letters past ASCII", value: `éşİ设\uFFFD${base}` },
  { name: "c: an emoji", value: `${base}😀` },
  { name: "d: 64 KB", value: base.repeat(Math.ceil(65536 / base.length)).slice(0, 65536 + (length % 7)) },
];

/** What the laws of 1945's first slice draw: a word and its length for the texts, a token, a status of each kind. */
export const slice1 = Arbitrary.all({
  base: word,
  length: between(0, 100000),
  token: word,
  serverStatus: between(500, 599),
  informational: between(100, 199),
  redirect: between(300, 399),
  marker: word,
});

// ---- a token that must never show

/** The forms a token is written in elsewhere: as it is, percent-encoded, as JSON text holds it, and in base64. */
export const tokenForms = (token: string): ReadonlyArray<string> => [
  token,
  encodeURIComponent(token),
  JSON.stringify(token).slice(1, -1),
  btoa(String.fromCharCode(...new TextEncoder().encode(token))),
];

/** Every text a value's own properties reach, names and symbols' descriptions included, cause chains and nested objects too. */
export const reachable = (root: object): ReadonlyArray<string> => {
  const seen = new Set<object>();
  const found: Array<string> = [];
  const pending: Array<object> = [root];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined || seen.has(next)) {
      continue;
    }

    seen.add(next);

    for (const key of Reflect.ownKeys(next)) {
      found.push(String(key));

      const value = Object.getOwnPropertyDescriptor(next, key)?.value;

      if (Predicate.isString(value)) {
        found.push(value);
      } else if (Predicate.isObjectOrArray(value)) {
        pending.push(value);
      }
    }
  }

  return found;
};

/** The text a span holds: its name, its attributes and its events. */
export const spanText = (span: Tracer.Span): string =>
  [
    span.name,
    ...[...span.attributes].map(
      ([key, value]) => `${key}=${Predicate.isString(value) ? value : JSON.stringify(value)}`,
    ),
    JSON.stringify(Predicate.hasProperty(span, "events") ? span.events : [], (_, each) =>
      Predicate.isBigInt(each) ? String(each) : each,
    ),
  ].join("\n");
