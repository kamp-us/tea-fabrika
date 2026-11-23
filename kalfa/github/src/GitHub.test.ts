// T1 as a value: what `GitHub.route` makes from a route text. The type laws are in GitHub.types.test.ts; this one runs, so a
// route that compiles but carries the wrong method or path is caught before `call` (ticket 1944's second slice) reads it.
import { assert, describe, expect, it } from "@effect/vitest";
import { Cause, DateTime, Duration, Effect, Exit, Option, Predicate, Schema } from "effect";
import {
  answerBody,
  between,
  CancelRun,
  CancelRunUnread,
  CreateIssue,
  Dispatch,
  DispatchPayload,
  DispatchUnread,
  failure,
  FilteredIssue,
  holdsUndefined,
  IssuePayload,
  json,
  ListCheckRuns,
  ListMigrations,
  ListNotifications,
  MakeToken,
  NUMBERS,
  observed,
  printings,
  reasonHeld,
  readBody,
  refusedInput,
  runs,
  SEED,
  sent,
  ShoutedIssue,
  ShoutedRuns,
  Shouter,
  shout,
  STATUSES,
  text,
  textVariants,
  TokenPayload,
  word,
} from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import {
  CANCEL,
  CHECK_RUNS,
  CREATE_ISSUE,
  DELETE_COMMENT,
  DELETE_ORG,
  DISPATCH,
  GET_BRANCH,
  GET_PULL,
  INSTALLATION_TOKEN,
  LANGUAGES,
  STAR,
  UPDATE_ISSUE,
  VECTORS,
  ZEN,
} from "./Octokit.test-support.ts";

const TitleOnly = Schema.Struct({ title: Schema.String });

const RefOnly = Schema.Struct({ ref: Schema.String });

// Plant: split the route text on its last space instead of its first, or drop the slash from the path, and a vector
// route names a wrong method or path.
it("T1 vector: route holds the route text, the method and the path template of each real route, and its declared parts", () => {
  // vector: the routes the plan names, each of a different shape; no generated input says what GitHub's description holds.
  const made = [
    GitHub.route(CANCEL),
    GitHub.route(CHECK_RUNS),
    GitHub.route(CREATE_ISSUE, { payload: TitleOnly }),
    GitHub.route(INSTALLATION_TOKEN),
    GitHub.route(DISPATCH, { payload: RefOnly, bodiless: [204] }),
    GitHub.route(GET_BRANCH),
    GitHub.route(GET_PULL),
    GitHub.route(ZEN),
    GitHub.route(LANGUAGES),
    GitHub.route(DELETE_ORG),
    GitHub.route(STAR),
    GitHub.route(UPDATE_ISSUE),
    GitHub.route(DELETE_COMMENT),
  ];

  expect(made.map(({ route, method, path }) => ({ route, method, path }))).toEqual(VECTORS);
  expect(made.every(({ _tag }) => _tag === "Route")).toBe(true);

  // The Schemas a caller declares stay on the value: the query as a Struct of its fields, the others as given.
  const success = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Finite })) });
  const declared = GitHub.route(CHECK_RUNS, { query: { per_page: Schema.Int }, success });

  expect(declared.success).toBe(success);
  expect(Object.keys(declared.query?.fields ?? {})).toEqual(["per_page"]);
  expect(GitHub.route(CREATE_ISSUE, { payload: TitleOnly }).payload).toBe(TitleOnly);
  expect(GitHub.route(CANCEL).payload).toBeUndefined();
  expect(GitHub.route(CANCEL).success).toBeUndefined();
});

/** The parts of a made `Route` that a caller declares, as the own keys the value holds. */
const held = (made: object): ReadonlyArray<string> =>
  ["bodiless", "payload", "query", "success"].filter((key) => Object.hasOwn(made, key));

// Plant: set `bodiless` to `undefined` instead of leaving it out, or drop it from the value, or keep it on a route that
// declared none; do the same for `success`, `query` and `payload`: the own keys differ from what was declared.
it("T1 vector: a made Route holds a declared part as an own key, and holds no key for a part left out", () => {
  // vector: one route for each combination of declared parts that GitHub's routes make; no generated input says what a route's parts are.
  const success = Schema.Struct({ workflow_run_id: Schema.Finite });
  const answer = Schema.Struct({ check_runs: Schema.Array(Schema.Struct({ id: Schema.Finite })) });

  expect(held(GitHub.route(CANCEL))).toEqual([]);
  expect(held(GitHub.route(CHECK_RUNS, { query: { per_page: Schema.Int } }))).toEqual(["query"]);
  expect(held(GitHub.route(CHECK_RUNS, { success: answer }))).toEqual(["success"]);
  expect(held(GitHub.route(CREATE_ISSUE, { payload: TitleOnly }))).toEqual(["payload"]);
  expect(held(GitHub.route(DISPATCH, { payload: RefOnly, bodiless: [204] }))).toEqual(["bodiless", "payload"]);
  expect(held(GitHub.route(DISPATCH, { payload: RefOnly, success, bodiless: [204] }))).toEqual([
    "bodiless",
    "payload",
    "success",
  ]);

  // The declared status list is kept as given, and a route that declared none has none.
  expect(GitHub.route(DISPATCH, { payload: RefOnly, bodiless: [204] }).bodiless).toEqual([204]);
  expect(GitHub.route(CHECK_RUNS).bodiless).toBeUndefined();
});

const enc = encodeURIComponent;

/** The three path names of the check runs route, in the order of its path. */
const SLOTS = ["owner", "repo", "ref"] as const;

const withSlot = (
  base: { readonly owner: string; readonly repo: string; readonly ref: string },
  slot: (typeof SLOTS)[number],
  value: string,
) => ({ ...base, [slot]: value });

// C1. Plant: delete the empty-text guard; trim a value before filling; use `encodeURI`; delete the `.` and `..` guard; call
// `encodeURIComponent` unwrapped (a lone surrogate then dies); drop control marks before filling; fill by replacing names one
// after another in the growing text; cut a value at 255 characters; delete the whole-number guard; read `params[name]` and
// not an own key; refuse only after sending.
describe("C1, the path", () => {
  it.effect.prop(
    "each path value is filled as encodeURIComponent writes it and decodes back; an empty or blank text, a dot alone, a lone surrogate, a number that is not whole, and a name only a prototype holds are refused before anything is sent",
    { owner: word, repo: word, ref: word, slot: between(0, 2), length: between(0, 100000) },
    ({ owner, repo, ref, slot, length }) =>
      Effect.gen(function* () {
        const base = { owner, repo, ref };
        const slotName = SLOTS[slot] ?? "ref";
        const route = ListCheckRuns.route;

        const call = (params: { readonly owner: string; readonly repo: string; readonly ref: string }) =>
          observed(GitHub.call(ListCheckRuns, { params, query: { per_page: 1 } }), () => json({ check_runs: [] }));

        for (const variant of textVariants(base[slotName], length)) {
          const params = withSlot(base, slotName, variant.value);
          const { exit, requests } = yield* call(params);

          if (variant.refused) {
            // `refused` carries the class the plan names: the call fails with an input refusal, never a defect.
            expect(refusedInput(exit, route), variant.name).toBe(true);
            expect(requests, `${variant.name}: nothing was sent`).toEqual([]);
            continue;
          }

          expect(Exit.isSuccess(exit), variant.name).toBe(true);
          expect(requests.length, variant.name).toBe(1);

          const [request] = requests;

          expect(request?.path, variant.name).toBe(
            `/repos/${enc(params.owner)}/${enc(params.repo)}/commits/${enc(params.ref)}/check-runs`,
          );
          expect(request?.params, variant.name).toEqual(params);
          expect(request?.route).toBe(route);
          expect(request?.method).toBe("GET");

          // Each filled segment decodes back to the value it was filled with.
          const segments = request?.path.split("/") ?? [];

          expect(segments.length, `${variant.name}: a value never adds a slash`).toBe(7);
          expect(
            [segments[2], segments[3], segments[5]].map((each) => decodeURIComponent(each ?? "")),
            variant.name,
          ).toEqual([params.owner, params.repo, params.ref]);
        }

        // (l) A params value that passes the type but holds a name only on its prototype, or not at all.
        const inherited = Object.assign(Object.create({ ref }), { owner, repo });
        const missing = { owner, repo };

        for (const [name, params] of [
          ["l: a name only the prototype holds", inherited],
          ["l: a name not held at all", missing],
        ] as const) {
          const { exit, requests } = yield* observed(
            GitHub.call(ListCheckRuns, { params, query: { per_page: 1 } }),
            () => json({ check_runs: [] }),
          );

          expect(refusedInput(exit, route), name).toBe(true);
          expect(requests, `${name}: nothing was sent`).toEqual([]);
        }

        // (k) The whole numbers of a path name that is a number, and the numbers it refuses.
        for (const number of NUMBERS) {
          const { exit, requests } = yield* observed(
            GitHub.call(CancelRun, { params: { owner, repo, run_id: number.value } }),
            () => json({}, 202),
          );

          if (number.refused) {
            expect(refusedInput(exit, CancelRun.route), number.name).toBe(true);
            expect(requests, `${number.name}: nothing was sent`).toEqual([]);
          } else {
            expect(Exit.isSuccess(exit), number.name).toBe(true);
            expect(requests[0]?.path, number.name).toBe(
              `/repos/${enc(owner)}/${enc(repo)}/actions/runs/${number.value}/cancel`,
            );
            expect(requests[0]?.params, number.name).toEqual({ owner, repo, run_id: String(number.value) });
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 300 } },
  );
});

/** The value of a success. */
const succeeded = <A, E>(exit: Exit.Exit<A, E>): A | undefined => (Exit.isSuccess(exit) ? exit.value : undefined);

// ---- C2, the query

type RunsQuery = GitHub.Input<typeof ListCheckRuns>["query"];

/** The query of a request with each key that was left out, as `undefined` or not at all, removed: the keys given. */
const given = (query: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(query).filter(([, each]) => each !== undefined));

// C2. Plant: send every declared key, an absent one as `null`; turn `undefined` into `null`; delete the falsy values;
// join an array with commas.
describe("C2, the query", () => {
  it.effect.prop(
    "a query key given and not undefined is in the request's query with its encoded value, a key left out or undefined is not, falsy values are kept, and an array keeps its items in order",
    {
      perPage: between(0, 100000),
      name: word,
      statusAt: between(0, 3),
      filterAt: between(0, 2),
      nameMode: between(0, 3),
      many: between(0, 4),
    },
    ({ perPage, name, statusAt, filterAt, nameMode, many }) =>
      Effect.gen(function* () {
        const drawn: RunsQuery = {
          per_page: perPage,
          ...(statusAt === 0 ? {} : { status: STATUSES[statusAt - 1] ?? "queued" }),
          ...(filterAt === 0 ? {} : { filter: filterAt === 1 ? "latest" : "all" }),
          ...(nameMode === 0 ? {} : { check_name: [undefined, "", name][nameMode - 1] }),
        };

        const queries: ReadonlyArray<RunsQuery> = [
          drawn,
          { per_page: perPage },
          { per_page: perPage, check_name: undefined },
          { per_page: 0, status: "queued", check_name: "", filter: "all" },
          { per_page: 0 },
        ];

        for (const query of queries) {
          const { exit, requests } = yield* observed(
            GitHub.call(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "main" }, query }),
            () => json({ check_runs: [] }),
          );

          expect(Exit.isSuccess(exit)).toBe(true);
          assert.deepStrictEqual(requests[0]?.query, given(query));
        }

        // A boolean that is false, and a number that is zero, are given.
        for (const query of [{}, { all: false }, { all: true }, { all: false, per_page: 0 }, { per_page: perPage }]) {
          const { exit, requests } = yield* observed(GitHub.call(ListNotifications, { query }), () => json([]));

          expect(Exit.isSuccess(exit)).toBe(true);
          assert.deepStrictEqual(requests[0]?.query, given(query));
        }

        // An array: none, one item, many.
        const lists: ReadonlyArray<ReadonlyArray<"repositories">> = [
          [],
          ["repositories"],
          Array.from({ length: many + 2 }, () => "repositories" as const),
        ];

        for (const exclude of lists) {
          const { exit, requests } = yield* observed(
            GitHub.call(ListMigrations, { params: { org: "o" }, query: { exclude } }),
            () => json([]),
          );

          expect(Exit.isSuccess(exit)).toBe(true);
          assert.deepStrictEqual(requests[0]?.query, { exclude });
        }

        // A route that declares no query sends an empty one.
        const none = yield* observed(
          GitHub.call(CancelRunUnread, { params: { owner: "o", repo: "r", run_id: 1 } }),
          () => json({}, 202),
        );

        assert.deepStrictEqual(none.requests[0]?.query, {});
      }),
    { arbitrary: { seed: SEED, runs: 300 } },
  );
});

// ---- C3, a left-out field is never sent

type IssueIn = GitHub.Input<typeof CreateIssue>["payload"];

type TokenIn = NonNullable<GitHub.Input<typeof MakeToken>["payload"]>;

type DispatchIn = GitHub.Input<typeof Dispatch>["payload"];

const OWNER = { owner: "o", repo: "r" } as const;

// C3. Plant: use `Schema.toCodecJson` (a left-out key becomes `null`); prune the top level only; drop `null` too; drop falsy
// values; treat `inputs` as closed; build the copy with `out[key] = value`; prune through a JSON round trip and delete the
// array-hole guard; delete the JSON guard; encode with the default `onExcessProperty`.
describe("C3, a left-out field is never sent", () => {
  it.effect.prop(
    "the body is the encoded payload with its left-out keys removed, with explicit null, falsy values and free keys kept; an array hole, a number JSON cannot hold and a key the Schema lacks are refused, and nothing is sent",
    { a: word, b: word, c: word, n: between(0, 1000000), picks: between(0, 7) },
    ({ a, b, c, n, picks }) =>
      Effect.gen(function* () {
        const issues: ReadonlyArray<IssueIn> = [
          { title: a, body: undefined },
          { title: a },
          { title: "", body: "", assignee: "", milestone: 0, labels: [], assignees: [] },
          { title: a, assignee: null, milestone: null, labels: [{ name: b, description: null, color: undefined }] },
          {
            title: a,
            labels: [
              { name: b, color: undefined },
              { name: c, color: "" },
            ],
          },
          { title: a, body: b, assignee: c, milestone: n, labels: [{ name: b }], assignees: [a, b, ""] },
          { title: a, body: picks % 2 === 0 ? undefined : b, labels: picks % 3 === 0 ? [] : [{ name: c }] },
        ];

        for (const payload of issues) {
          const { exit, requests } = yield* observed(GitHub.call(CreateIssue, { params: OWNER, payload }), () =>
            json({}, 201),
          );

          expect(Exit.isSuccess(exit), JSON.stringify(payload)).toBe(true);
          assert.deepStrictEqual(requests[0]?.body, sent(IssuePayload, payload));
          expect(holdsUndefined(requests[0]?.body)).toBe(false);
        }

        const tokens: ReadonlyArray<TokenIn> = [
          {},
          { permissions: undefined },
          { permissions: {} },
          { permissions: { issues: undefined, contents: "read" } },
          { permissions: { issues: "write" }, repository_ids: [0, n], repositories: [a, ""] },
          { repositories: [] },
        ];

        for (const payload of tokens) {
          const { exit, requests } = yield* observed(
            GitHub.call(MakeToken, { params: { installation_id: n }, payload }),
            () => json({ token: a, expires_at: "2026-11-22T00:00:00.000Z" }, 201),
          );

          expect(Exit.isSuccess(exit), JSON.stringify(payload)).toBe(true);
          assert.deepStrictEqual(requests[0]?.body, sent(TokenPayload, payload));
          expect(holdsUndefined(requests[0]?.body)).toBe(false);
        }

        // The free keys under `inputs`: any text, the names an object holds, falsy values, null, and `undefined` at depth 3 and 4.
        const dispatches: ReadonlyArray<DispatchIn> = [
          { ref: a },
          { ref: a, return_run_details: false },
          {
            ref: a,
            inputs: Object.fromEntries([
              ["__proto__", b],
              ["constructor", c],
              ["toString", 0],
              [a, false],
              [`${b}1`, ""],
              [`${c}2`, []],
              [`${a}3`, {}],
              [`${b}4`, null],
            ]),
          },
          { ref: a, inputs: { x: { y: { z: undefined, w: n } }, list: [{ k: undefined, v: 2 }], u: undefined } },
        ];

        for (const payload of dispatches) {
          const { exit, requests } = yield* observed(
            GitHub.call(Dispatch, { params: { ...OWNER, workflow_id: "ci.yml" }, payload }),
            () => text("", 204),
          );

          expect(Exit.isSuccess(exit), JSON.stringify(payload)).toBe(true);
          assert.deepStrictEqual(requests[0]?.body, sent(DispatchPayload, payload));
          expect(holdsUndefined(requests[0]?.body)).toBe(false);
        }

        // An own key called __proto__ stays an own key of the body.
        const proto = yield* observed(
          GitHub.call(Dispatch, {
            params: { ...OWNER, workflow_id: "ci.yml" },
            payload: { ref: a, inputs: Object.fromEntries([["__proto__", { v: n }]]) },
          }),
          () => text("", 204),
        );

        const body = proto.requests[0]?.body;
        const inputs = Predicate.isObject(body) ? body["inputs"] : undefined;

        expect(Predicate.isObject(inputs) && Object.hasOwn(inputs, "__proto__")).toBe(true);

        // (v) an array hole, (w) a number JSON cannot hold, (x) a key the Schema lacks, passed through a variable.
        const extraIssue = { title: a, surprise: n };
        const extraToken = { permissions: { issues: "read" as const, surprise: n } };

        const refused: ReadonlyArray<{
          readonly name: string;
          readonly route: string;
          readonly program: Effect.Effect<unknown, GitHub.GitHubError | GitHub.RateLimited, GitHub.GitHub>;
        }> = [
          {
            name: "v: a hole in an array",
            route: Dispatch.route,
            program: GitHub.call(Dispatch, {
              params: { ...OWNER, workflow_id: "w" },
              payload: { ref: a, inputs: { list: [1, undefined, 2] } },
            }),
          },
          {
            name: "v: a hole in an array in an array",
            route: Dispatch.route,
            program: GitHub.call(Dispatch, {
              params: { ...OWNER, workflow_id: "w" },
              payload: { ref: a, inputs: { list: [[undefined]] } },
            }),
          },
          {
            name: "w: NaN",
            route: CreateIssue.route,
            program: GitHub.call(CreateIssue, { params: OWNER, payload: { title: a, milestone: Number.NaN } }),
          },
          {
            name: "w: Infinity",
            route: CreateIssue.route,
            program: GitHub.call(CreateIssue, {
              params: OWNER,
              payload: { title: a, milestone: Number.POSITIVE_INFINITY },
            }),
          },
          {
            name: "w: negative Infinity in free keys",
            route: Dispatch.route,
            program: GitHub.call(Dispatch, {
              params: { ...OWNER, workflow_id: "w" },
              payload: { ref: a, inputs: { deep: { n: Number.NEGATIVE_INFINITY } } },
            }),
          },
          {
            name: "x: a key the issue lacks",
            route: CreateIssue.route,
            program: GitHub.call(CreateIssue, { params: OWNER, payload: extraIssue }),
          },
          {
            name: "x: a key the permissions lack",
            route: MakeToken.route,
            program: GitHub.call(MakeToken, { params: { installation_id: 1 }, payload: extraToken }),
          },
        ];

        for (const each of refused) {
          const { exit, requests } = yield* observed(each.program, () => json({}, 201));

          expect(refusedInput(exit, each.route), each.name).toBe(true);
          expect(requests, `${each.name}: nothing was sent`).toEqual([]);
        }
      }),
    { arbitrary: { seed: SEED, runs: 300 } },
  );
});

// ---- C4, the answer

// C4. Plant: decode with `onExcessProperty: "error"`; give the encoded value; read the body with a hand JSON reader that
// drops `\u` escapes; decode the empty body of the 204.
describe("C4, the answer", () => {
  it.effect.prop(
    "call gives the declared fields of the answer, decoded, however the JSON is printed and whatever else it holds; a 204 gives none and a 200 some",
    { list: runs, token: word, expires: between(0, 4_000_000_000_000), run: word, url: word },
    ({ list, token, expires, run, url }) =>
      Effect.gen(function* () {
        // The runs, printed three ways, with fields and keys the caller does not read, from none to fifty.
        for (const each of [list, [], list.slice(0, 1)]) {
          for (const printing of printings(answerBody(each))) {
            const { exit } = yield* observed(
              GitHub.call(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "main" }, query: { per_page: 1 } }),
              () => text(printing.body),
            );

            assert.deepStrictEqual(succeeded(exit), readBody(each), printing.name);
          }
        }

        // The decoded type is not the encoded one: a date.
        const iso = DateTime.formatIso(DateTime.makeUnsafe(expires));

        const made = yield* observed(GitHub.call(MakeToken, { params: { installation_id: 1 }, payload: {} }), () =>
          json({ token, expires_at: iso, permissions: { issues: "read" }, repository_selection: "all" }, 201),
        );

        assert.deepStrictEqual(
          succeeded(made.exit),
          Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String, expires_at: Schema.DateTimeUtcFromString }))({
            token,
            expires_at: iso,
          }),
        );

        // A dispatch: 204 has no body to read, 200 has one.
        const dispatch = (reply: GitHub.Reply) =>
          observed(
            GitHub.call(Dispatch, { params: { owner: "o", repo: "r", workflow_id: "w" }, payload: { ref: "main" } }),
            () => reply,
          );

        const empty = yield* dispatch(text("", 204));
        const body = yield* dispatch(json({ workflow_run_id: 1, run_url: url, html_url: url }));

        assert.deepStrictEqual(succeeded(empty.exit), Option.none());
        assert.deepStrictEqual(succeeded(body.exit), Option.some({ workflow_run_id: 1, run_url: url }));

        // With nothing declared to read, an answer is `void`: the body is not read, whatever it is.
        const unread = yield* observed(
          GitHub.call(DispatchUnread, { params: { owner: "o", repo: "r", workflow_id: "w" }, payload: { ref: run } }),
          () => text("<not json>", 200),
        );

        const unread204 = yield* observed(
          GitHub.call(DispatchUnread, { params: { owner: "o", repo: "r", workflow_id: "w" }, payload: { ref: run } }),
          () => text("", 204),
        );

        const cancelled = yield* observed(
          GitHub.call(CancelRun, { params: { owner: "o", repo: "r", run_id: 1 } }),
          () => json({}, 202),
        );

        expect(Exit.isSuccess(unread.exit)).toBe(true);
        expect(succeeded(unread.exit)).toBeUndefined();
        expect(succeeded(unread204.exit)).toBeUndefined();
        assert.deepStrictEqual(succeeded(cancelled.exit), {});
      }),
    { arbitrary: { seed: SEED, runs: 300 } },
  );
});

// ---- C5, an answer that cannot be read

const ROUTE = ListCheckRuns.route;

// A function, so a missing `call` fails each law that uses it, not the whole file.
const callRuns = () =>
  GitHub.call(ListCheckRuns, { params: { owner: "o", repo: "r", ref: "main" }, query: { per_page: 1 } });

// C5. Plant: decode with `Effect.orDie`; report the side as `input`; leave out the cause.
describe("C5, an answer that cannot be read", () => {
  it.effect.prop(
    "an answer of the wrong shape, a missing key, a value outside the Schema, text that is not JSON, or JSON of another kind fails with Undecodable on the answer side and a cause, never a defect",
    { list: runs, at: between(0, 100000), mark: word },
    ({ list, at, mark }) =>
      Effect.gen(function* () {
        const one = list[0] ?? {
          id: 1,
          name: mark,
          status: "queued" as const,
          conclusion: null,
          head_sha: mark,
          app: { id: 1, slug: mark, more: { deep: [1] } },
        };

        const rest = list.slice(1);
        const good = JSON.stringify(answerBody([one, ...rest]));
        const cut = 1 + (at % (good.length - 1));

        const broken: ReadonlyArray<{ readonly name: string; readonly body: string }> = [
          { name: "G: the list is a number", body: JSON.stringify({ check_runs: 7 }) },
          {
            name: "G: an id is a text, three levels down",
            body: JSON.stringify({ check_runs: [{ ...one, id: String(one.id) }, ...rest] }),
          },
          { name: "G: a status is a number", body: JSON.stringify({ check_runs: [{ ...one, status: at }, ...rest] }) },
          {
            name: "G: a name is an object",
            body: JSON.stringify({ check_runs: [...rest, { ...one, name: { mark } }] }),
          },
          { name: "H: the list is missing", body: JSON.stringify({ total_count: 0 }) },
          {
            name: "H: a name is missing",
            body: JSON.stringify({ check_runs: [{ id: 1, status: "queued", conclusion: null }, ...rest] }),
          },
          {
            name: "I: a status outside the literals",
            body: JSON.stringify({ check_runs: [{ ...one, status: "complted" }, ...rest] }),
          },
          {
            name: "I: a conclusion outside the literals",
            body: JSON.stringify({ check_runs: [{ ...one, conclusion: mark }, ...rest] }),
          },
          { name: "J: empty", body: "" },
          { name: "J: HTML", body: `<html><body>${mark}</body></html>` },
          { name: "J: cut at a byte", body: good.slice(0, cut) },
          { name: "K: null", body: "null" },
          { name: "K: a number", body: String(at) },
          { name: "K: a list", body: "[]" },
          { name: "K: a list of an object", body: JSON.stringify([answerBody([one])]) },
          { name: "K: a text", body: JSON.stringify(mark) },
        ];

        for (const each of broken) {
          const { exit, requests } = yield* observed(callRuns(), () => text(each.body));
          const found = reasonHeld(exit);

          expect(requests.length, each.name).toBe(1);
          expect(found?.operation, each.name).toBe(ROUTE);
          expect(found?.reason._tag, each.name).toBe("Undecodable");

          if (found?.reason._tag === "Undecodable") {
            expect(found.reason.side, each.name).toBe("answer");
            expect(found.reason.cause, `${each.name}: the cause is kept`).toBeDefined();
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// ---- C6, GitHub's 4xx

type ErrorBody = Record<string, unknown>;

// C6. Plant: require `message`; read `errors` as objects only; keep `errors` and drop the `value` key.
describe("C6, GitHub's 4xx", () => {
  it.effect.prop(
    "a 4xx fails with ClientError holding the reply's status, and a message, a documentation URL and errors exactly when GitHub's body had them, each as GitHub said it",
    {
      status: between(400, 499),
      message: word,
      slug: word,
      echo: word,
      number: between(-1000, 1000),
      presence: between(0, 7),
      kind: between(0, 5),
    },
    ({ status, message, slug, echo, number, presence, kind }) =>
      Effect.gen(function* () {
        const hasMessage = (presence & 1) !== 0;
        const hasUrl = (presence & 2) !== 0;
        const hasErrors = (presence & 4) !== 0;

        const errorLists: ReadonlyArray<ReadonlyArray<Schema.Json>> = [
          [{ resource: "Issue", field: "title", code: "invalid", value: echo }],
          [
            { resource: "Issue", field: "n", code: "invalid", value: number },
            { code: "missing", value: null },
          ],
          ["first", echo],
          [],
          [{ message: echo }, "mixed"],
          [{ resource: echo, nested: { value: [echo, number] } }],
        ];

        const errors = errorLists[kind] ?? [];

        const bodies: ReadonlyArray<{
          readonly name: string;
          readonly reply: GitHub.Reply;
          readonly expect: ErrorBody;
        }> = [
          {
            name: "L, M, N: a body with some of the fields",
            reply: json(
              {
                ...(hasMessage ? { message } : {}),
                ...(hasUrl ? { documentation_url: `https://docs.github.com/${slug}` } : {}),
                ...(hasErrors ? { errors } : {}),
                // Q: more than GitHub's schema names.
                url: `https://api.github.com/${slug}`,
                status: String(status),
                other: { deep: [1] },
              },
              status,
            ),
            expect: {
              ...(hasMessage ? { message } : {}),
              ...(hasUrl ? { documentationUrl: `https://docs.github.com/${slug}` } : {}),
              ...(hasErrors ? { errors } : {}),
            },
          },
          {
            name: "L: every field",
            reply: json({ message, documentation_url: `https://docs.github.com/${slug}`, errors }, status),
            expect: { message, documentationUrl: `https://docs.github.com/${slug}`, errors },
          },
          { name: "O: an empty object", reply: json({}, status), expect: {} },
          { name: "P: HTML", reply: text(`<html>${echo}</html>`, status), expect: {} },
          { name: "P: empty", reply: text("", status), expect: {} },
          { name: "P: a list", reply: json([message], status), expect: {} },
          { name: "P: null", reply: text("null", status), expect: {} },
          { name: "R: only a message", reply: json({ message }, status), expect: { message } },
        ];

        for (const each of bodies) {
          const { exit, requests } = yield* observed(callRuns(), () => each.reply);
          const found = reasonHeld(exit);

          expect(requests.length, each.name).toBe(1);
          expect(found?.operation, each.name).toBe(ROUTE);
          expect(found?.reason._tag, each.name).toBe("ClientError");

          if (found?.reason._tag === "ClientError") {
            const reason = found.reason;

            expect(reason.status, each.name).toBe(status);

            for (const key of ["message", "documentationUrl", "errors"] as const) {
              expect(Object.hasOwn(reason, key), `${each.name}: ${key} is there exactly when GitHub sent it`).toBe(
                Object.hasOwn(each.expect, key),
              );
            }

            // `message` is also the name of an error's own text, so a field that GitHub left out is read as given only when it is there.
            if (Object.hasOwn(each.expect, "message")) {
              assert.deepStrictEqual(reason.message, each.expect.message, each.name);
            }

            if (Object.hasOwn(each.expect, "documentationUrl")) {
              assert.deepStrictEqual(reason.documentationUrl, each.expect.documentationUrl, each.name);
            }

            if (Object.hasOwn(each.expect, "errors")) {
              assert.deepStrictEqual(reason.errors, each.expect.errors, each.name);
            }
          }
        }
      }),
    { arbitrary: { seed: SEED, runs: 300 } },
  );
});

// ---- C7, other statuses

// C7. Plant: read a 5xx as ClientError; treat only 200 as a success.
describe("C7, other statuses", () => {
  it.effect.prop(
    "a status that is not 2xx or 4xx fails with Undecodable on the answer side, naming the status and holding no cause; each 2xx status is a success",
    {
      informational: between(100, 199),
      redirect: between(300, 399),
      server: between(500, 599),
      success: between(200, 299),
    },
    ({ informational, redirect, server, success }) =>
      Effect.gen(function* () {
        for (const status of [informational, redirect, server]) {
          const { exit } = yield* observed(callRuns(), () => json({ check_runs: [], message: "nope" }, status));
          const found = reasonHeld(exit);

          expect(found?.operation).toBe(ROUTE);
          expect(found?.reason._tag, String(status)).toBe("Undecodable");

          if (found?.reason._tag === "Undecodable") {
            expect(found.reason.side).toBe("answer");
            expect(found.reason.message, "the message names the status").toContain(String(status));
            expect(found.reason.cause, "no cause: nothing failed to decode").toBeUndefined();
          }
        }

        const { exit } = yield* observed(GitHub.call(CancelRun, { params: { owner: "o", repo: "r", run_id: 1 } }), () =>
          json({}, success),
        );

        assert.deepStrictEqual(succeeded(exit), {});

        // A failure of the service's own `send` passes through unchanged.
        const limited = new GitHub.RateLimited({
          operation: ROUTE,
          until: DateTime.makeUnsafe(success),
          limit: "primary",
        });

        const passed = yield* Effect.exit(
          callRuns().pipe(
            Effect.provideService(GitHub.GitHub, { send: () => Effect.fail(limited), poll: Duration.seconds(1) }),
          ),
        );

        expect(failure(passed)).toBe(limited);
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// ---- C8, input refused, nothing sent

// C8. Plant: encode after sending.
describe("C8, input refused, nothing sent", () => {
  it.effect.prop(
    "a payload the Schema refuses (a fraction label an integer is, an empty text label a filter wants one) fails with Undecodable on the input side and sends nothing",
    { title: word, whole: between(0, 100000), fraction: between(1, 9), at: between(0, 1) },
    ({ title, whole, fraction, at }) =>
      Effect.gen(function* () {
        const refused: ReadonlyArray<IssueFiltered> = [
          { title, milestone: whole + fraction / 10 },
          { title: "", milestone: whole },
          { title: "", milestone: at === 0 ? undefined : whole + 0.5 },
        ];

        for (const payload of refused) {
          const { exit, requests } = yield* observed(
            GitHub.call(FilteredIssue, {
              params: OWNER,
              payload:
                payload.milestone === undefined
                  ? { title: payload.title }
                  : { title: payload.title, milestone: payload.milestone },
            }),
            () => json({}, 201),
          );

          expect(refusedInput(exit, FilteredIssue.route), JSON.stringify(payload)).toBe(true);
          expect(requests, "nothing was sent").toEqual([]);
        }

        // The same route with good values is sent.
        const { exit, requests } = yield* observed(
          GitHub.call(FilteredIssue, { params: OWNER, payload: { title, milestone: whole } }),
          () => json({}, 201),
        );

        expect(Exit.isSuccess(exit)).toBe(true);
        assert.deepStrictEqual(requests[0]?.body, { title, milestone: whole });
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});

interface IssueFiltered {
  readonly title: string;
  readonly milestone: number | undefined;
}

// ---- C9, the span

// The marks of (d) a URL, (f) letters past ASCII and (h) JSON and templates, as a marker's middle.
const URL_MARKS = ["%", "%2F", "?", "#", "&=+;@:", " "] as const;

const LETTERS = ["é", "设", "�", "😀"] as const;

const TEMPLATE_MARKS = ['"', "\\", "{", "}", "[", "]", "{repo}"] as const;

const attributesText = (span: { readonly attributes: ReadonlyMap<string, unknown> }): string =>
  [...span.attributes]
    .map(([key, value]) => `${key}=${Predicate.isBigInt(value) ? String(value) : JSON.stringify(value)}`)
    .join("\n");

// C9. Plant: name the span `GitHub.call`; add the filled path as `url.full`; give `GitHubError` a `message` from its
// reason; give `GitHubError` a `cause` of its reason.
describe("C9, the span", () => {
  it.effect.prop(
    "each call ends one span named github.call with the method, the reply's status and the route text, and a marker put in a path, query or payload value, a read or unread answer field, a 4xx message or errors value, or a value that fails to decode is in no attribute and in nothing the failure renders",
    {
      n: between(0, 2_000_000_000),
      d: between(0, URL_MARKS.length - 1),
      f: between(0, LETTERS.length - 1),
      h: between(0, TEMPLATE_MARKS.length - 1),
    },
    ({ n, d, f, h }) =>
      Effect.gen(function* () {
        const tag = `zq${n.toString(36)}x`;

        const markers = [
          `${tag}${URL_MARKS[d]}${tag}`,
          `${tag}${LETTERS[f]}${tag}`,
          `${tag}${TEMPLATE_MARKS[h]}${tag}`,
        ];

        const runs = (ref: string, check_name?: string) =>
          GitHub.call(ListCheckRuns, {
            params: { owner: "o", repo: "r", ref },
            query: check_name === undefined ? { per_page: 1 } : { per_page: 1, check_name },
          });

        for (const marker of markers) {
          const places: ReadonlyArray<{
            readonly name: string;
            readonly program: Effect.Effect<unknown, GitHub.GitHubError | GitHub.RateLimited, GitHub.GitHub>;
            readonly reply: GitHub.Reply;
          }> = [
            { name: "a path value", program: runs(marker), reply: json({ check_runs: [] }) },
            { name: "a query value", program: runs("main", marker), reply: json({ check_runs: [] }) },
            {
              name: "a payload value",
              program: GitHub.call(CreateIssue, { params: OWNER, payload: { title: marker } }),
              reply: json({}, 201),
            },
            {
              name: "a read answer field",
              program: runs("main"),
              reply: json({ check_runs: [{ id: 1, name: marker, status: "queued", conclusion: null }] }),
            },
            { name: "an unread answer field", program: runs("main"), reply: json({ check_runs: [], other: marker }) },
            { name: "a 4xx message", program: runs("main"), reply: json({ message: marker }, 422) },
            {
              name: "a 4xx errors value",
              program: runs("main"),
              reply: json({ errors: [{ value: marker }, marker] }, 422),
            },
            {
              name: "the value that fails to decode",
              program: runs("main"),
              reply: json({ check_runs: [{ id: 1, name: "n", status: marker, conclusion: null }] }),
            },
          ];

          for (const place of places) {
            const { exit, spans, requests } = yield* observed(place.program, () => place.reply);
            const label = `${place.name}, ${marker}`;

            expect(
              spans.map((span) => span.name),
              label,
            ).toEqual(["github.call"]);

            const [span] = spans;
            const attributes = Object.fromEntries(span?.attributes ?? []);
            const operation = place.name === "a payload value" ? CreateIssue : ListCheckRuns;

            expect(span?.status._tag, label).toBe("Ended");
            expect(attributes["http.request.method"], label).toBe(operation.method);
            expect(attributes["kalfa.github.operation"], label).toBe(operation.route);
            expect(requests.length, label).toBe(1);
            expect(attributes["http.response.status_code"], label).toBe(place.reply.status);

            for (const key of Object.keys(attributes)) {
              expect(key, label).not.toBe("url.full");
              expect(key.toLowerCase(), label).not.toContain("header");
            }

            expect(
              attributesText(span ?? { attributes: new Map() }),
              `${label}: an attribute holds the marker`,
            ).not.toContain(tag);

            if (Exit.isFailure(exit)) {
              for (const error of Cause.prettyErrors(exit.cause, { includeCauseInStack: true })) {
                for (const rendered of [error.name, error.message, error.stack ?? ""]) {
                  expect(rendered, `${label}: the failure renders the marker`).not.toContain(tag);
                }
              }
            }
          }
        }

        // A call refused before it sends has no status code, and still ends its one span.
        const refused = yield* observed(runs(".."), () => json({ check_runs: [] }));
        const [only] = refused.spans;

        expect(refused.spans.map((span) => span.name)).toEqual(["github.call"]);
        expect(only?.status._tag).toBe("Ended");
        expect(only?.attributes.has("http.response.status_code")).toBe(false);
        expect(only?.attributes.get("kalfa.github.operation")).toBe(ListCheckRuns.route);
      }),
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// ---- C11, a Schema that may be async stays an Effect

// C11. Plant: encode with `Schema.encodeExit` (sync); decode with `Schema.decodeUnknownExit`.
describe("C11, a Schema that may be async stays an Effect", () => {
  it.effect.prop(
    "a query, a payload and an answer whose transformation yields and needs a service succeed, with the service's work in what is sent and in what is read, and nothing becomes a defect",
    { name: word, title: word, answer: word },
    ({ name, title, answer }) =>
      Effect.gen(function* () {
        const service = { shout: (text: string) => Effect.succeed(shout(text)) };

        const runs = yield* observed(
          GitHub.call(ShoutedRuns, {
            params: { owner: "o", repo: "r", ref: "main" },
            query: { per_page: 1, check_name: name },
          }),
          () => json({ check_runs: [{ id: 1, name: answer }] }),
        ).pipe(Effect.provideService(Shouter, service));

        expect(Exit.isSuccess(runs.exit)).toBe(true);
        assert.deepStrictEqual(runs.requests[0]?.query, { per_page: 1, check_name: shout(name) });
        assert.deepStrictEqual(succeeded(runs.exit), { check_runs: [{ id: 1, name: shout(answer) }] });

        const issue = yield* observed(GitHub.call(ShoutedIssue, { params: OWNER, payload: { title } }), () =>
          json({}, 201),
        ).pipe(Effect.provideService(Shouter, service));

        expect(Exit.isSuccess(issue.exit)).toBe(true);
        assert.deepStrictEqual(issue.requests[0]?.body, { title: shout(title) });

        // The decoding that needs the service is refused as an Undecodable answer when its work fails; here it never runs on bad JSON.
        const broken = yield* observed(
          GitHub.call(ShoutedRuns, {
            params: { owner: "o", repo: "r", ref: "main" },
            query: { per_page: 1, check_name: name },
          }),
          () => text("not json"),
        ).pipe(Effect.provideService(Shouter, service));

        expect(reasonHeld(broken.exit)?.reason._tag).toBe("Undecodable");
      }),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});
