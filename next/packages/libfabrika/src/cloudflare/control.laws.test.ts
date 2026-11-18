// L8 of the Reflect ban (docs/plan/quests/reflect-ban-PLAN.md, slice 10, kind 5; decision 0554), next/.
// The control door calls exactly the method its request names, on the object its request names, with
// the arguments that method's own schema decoded from the request. Arguments its schema refuses are
// refused with `bad_row` before any call, any other name with `unknown_method`, and a Project `commit`
// that names its own process with `reserved`. Only the platform is fake: each Durable Object namespace
// hands out a `Stub.make` stub that writes down every call it is given and then rejects it, so the real
// door, the real clients and `rpc` run on it.
//
// The allowed names are the door's documented sets (control.ts's doc block: "Only the listed methods
// of each target are called"), written out here as the law's own oracle, so a name the door drops or
// adds fails the law. Each method's arguments come from the door's own table of argument schemas,
// `Payloads` in control.ts, one tuple per method (the "payload" of Effect's `Rpc.make`): a valid
// request is that schema's Arbitrary, encoded and sent as JSON, and the noise mixed in is JSON values
// in place of the whole list or of one argument, one argument dropped, or one too many. Whether a
// request is valid is what that schema says of the arguments the door received.
//
// The law walks: each run asks for every case it has not reached yet (each method called, and for each
// target a refused argument list and a refused name, and the reserved commit), then a few free picks,
// and it fails loudly when a case was never reached.
//
// Plants: drop one key from the door's table (L8 red for that method); call the method on the raw
// arguments without decoding them (red: a refused list reaches the object); call it anyway when the
// decoder refuses (red: `bad_row` is never answered, and the object is called).
import { describe, expect, it } from "@effect/vitest";
import { runsFor, Stub } from "@kampus/vitest";
import { Arbitrary, Effect, Predicate, Redacted, Result, Schema } from "effect";
import type { ProcessBinding, ProjectBinding, RecordBinding } from "./bindings.ts";
import { control, Payloads } from "./control.ts";
import type { Env } from "./runtime.ts";

const SEED = 119120;

/** The door's Response body did not read. */
class Unread extends Schema.TaggedError<Unread, { readonly brand: unique symbol }>()("Unread", {
  cause: Schema.Defect(),
}) {}

const TOKEN = "control-token-law";

/** The names each target's door calls, from its doc block and today's sets. */
const allowed = {
  project: [
    "clientConnect",
    "challenge",
    "initialize",
    "route",
    "grant",
    "read",
    "append",
    "wait",
    "start",
    "exit",
    "info",
    "sign",
    "commit",
    "join",
    "leave",
    "online",
    "brain",
    "codeInstall",
    "codeFailed",
  ],
  process: ["msg", "open", "due", "restart", "abort", "activity", "recover", "savedAlarm"],
  record: ["write", "read", "content", "deleteContent"],
} as const;

type Target = keyof typeof allowed;

const targets: ReadonlyArray<Target> = ["project", "process", "record"];

const allowedFor = (target: Target): ReadonlySet<string> => new Set(allowed[target]);

/** One method's arguments as the door decodes them: a tuple of its parameters, sent as JSON. */
type Payload = Schema.Codec<ReadonlyArray<unknown>, ReadonlyArray<unknown>>;

/** The door's table of argument schemas, read under the names this law calls: a table that misses a
 *  name, or whose decoder needs a service, fails the type check here. */
const payloads: { readonly [T in Target]: { readonly [M in (typeof allowed)[T][number]]: Payload } } = Payloads;

/** The schema the door decodes `method`'s arguments with, or undefined for a name it does not call. */
const payloadFor = (target: Target, method: string): Payload | undefined => {
  const table: Readonly<Record<string, Payload>> = payloads[target];
  return allowedFor(target).has(method) ? table[method] : undefined;
};

/** Names a door must refuse: real members it does not list, another target's names, an object's own
 *  keys, and any string. */
const OTHERS = [
  ...allowed.project,
  ...allowed.process,
  ...allowed.record,
  "processObject",
  "settingsStart",
  "settingsRead",
  "code",
  "target",
  "knock",
  "register",
  "disconnect",
  "mail",
  "hands",
  "processStart",
  "swap",
  "configure",
  "usage",
  "descriptor",
  "mailed",
  "alarm",
  "fetch",
  "then",
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
] as const;

const Other = Arbitrary.schema(Schema.Union([Schema.Literals(OTHERS), Schema.String]));
const JsonArgs = Arbitrary.schema(Schema.Array(Schema.Json));
const Json = Arbitrary.schema(Schema.Json);
const Noise = Arbitrary.schema(Schema.Literals(["json", "swap", "drop", "extra"]));

/** The request body as JSON, and the arguments the door reads back out of it. */
const Body = Schema.fromJsonString(Schema.Unknown);
const Received = Schema.fromJsonString(Schema.Struct({ args: Schema.Array(Schema.Unknown) }));

/** The door's answer: a value, or a failure's reason. */
const Answer = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ value: Schema.Unknown }),
    Schema.Struct({ error: Schema.Struct({ reason: Schema.String }) }),
  ]),
);

/** The reasons the door refuses a request with, before it calls anything. */
const REFUSALS: ReadonlySet<string> = new Set(["unknown_method", "bad_row", "reserved"]);

/** One walk: its seed, how many free picks follow the cases, and the request's project and name. */
const Walk = Schema.Struct({
  seed: Schema.Int,
  extra: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 })),
  project: Schema.String,
  name: Schema.String,
});

/** One call a stub was given: which object, by which namespace key, which method and what arguments. */
type Call = { readonly target: Target; readonly key: string; readonly method: string; readonly args: unknown };

type Request = { readonly target: Target; readonly method: string; readonly args: ReadonlyArray<unknown> };

const unexpected = (name: string) => {
  throw new Error(`the control door read ${name} on a binding this law does not give it`);
};

/** The platform: each namespace's stub writes its calls down and rejects them. A Project answers
 *  `processObject`, the name lookup the door makes before a Process call, with its own process ID. */
const platform = () => {
  const calls: Array<Call> = [];
  const lost =
    (target: Target, key: string) =>
    (method: string) =>
    async (...args: ReadonlyArray<unknown>) => {
      calls.push({ target, key, method, args });
      throw new Error(`${target}.${method} is lost in this law`);
    };
  const env = Stub.make<Env>(unexpected, {
    PROJECT: Stub.make<Env["PROJECT"]>(unexpected, {
      getByName: (key) =>
        Stub.make<DurableObjectStub<ProjectBinding>>(lost("project", key), {
          processObject: async (pid) => `object-of-${pid}`,
        }),
    }),
    PROCESS: Stub.make<Env["PROCESS"]>(unexpected, {
      getByName: (key) => Stub.make<DurableObjectStub<ProcessBinding>>(lost("process", key)),
    }),
    RECORD: Stub.make<Env["RECORD"]>(unexpected, {
      getByName: (key) => Stub.make<DurableObjectStub<RecordBinding>>(lost("record", key)),
    }),
  });
  return { env, calls };
};

const ask = Effect.fnUntraced(function* (env: Env, body: string) {
  const response = yield* control(
    new Request("http://127.0.0.1/control", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body,
    }),
    env,
    Redacted.make(TOKEN),
    {},
  );
  const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (cause) => new Unread({ cause }) });
  return { status: response.status, answer: yield* Schema.decodeUnknownEffect(Answer)(text) };
});

/** The reason a failure answer gives, or undefined for a value. */
const refusal = (answer: typeof Answer.Type) => ("error" in answer ? answer.error.reason : undefined);

const sample = Effect.fnUntraced(function* <A>(arbitrary: Arbitrary.Arbitrary<A>, seed: number) {
  return (yield* Arbitrary.sampleEffect(arbitrary, { seed, count: 1 }))[0]!;
});

const pick = <const A extends string>(list: ReadonlyArray<A>, seed: number) =>
  sample(Arbitrary.schema(Schema.Literals(list)), seed);

/** Each payload's Arbitrary, made once. */
const arbitraries = new Map<Payload, Arbitrary.Arbitrary<ReadonlyArray<unknown>>>();

const arbitraryFor = (payload: Payload) => {
  const made = arbitraries.get(payload) ?? Arbitrary.schema(payload);
  arbitraries.set(payload, made);
  return made;
};

/** A method's arguments as a caller sends them: its schema's value, encoded. A value the schema
 *  cannot encode is sent as JSON noise instead, which the oracle then judges. */
const valid = Effect.fnUntraced(function* (target: Target, method: string, seed: number) {
  const payload = payloadFor(target, method);

  if (payload === undefined) {
    return yield* sample(JsonArgs, seed);
  }

  const value = yield* sample(arbitraryFor(payload), seed);
  const encoded = yield* Effect.result(Schema.encodeUnknownEffect(payload)(value));
  return Result.isSuccess(encoded) ? encoded.success : yield* sample(JsonArgs, seed);
});

/** One way to spoil a method's arguments: JSON for the whole list or one argument, one dropped, or one
 *  too many. */
const spoiled = Effect.fnUntraced(function* (target: Target, seed: number) {
  const method = yield* pick(allowed[target], seed);
  const base = yield* valid(target, method, seed + 1);
  const noise = yield* sample(Noise, seed + 2);
  const one = yield* sample(Json, seed + 3);
  const at = base.length === 0 ? 0 : Math.abs(seed) % base.length;
  const args =
    noise === "json"
      ? yield* sample(JsonArgs, seed + 4)
      : noise === "swap" && base.length > 0
        ? base.map((arg, i) => (i === at ? one : arg))
        : noise === "drop" && base.length > 0
          ? base.slice(0, -1)
          : [...base, one];
  return { target, method, args };
});

/** The cases each walk must reach, and how to build a request for each. */
const cases = new Map<string, (seed: number) => Effect.Effect<Request, unknown>>([
  ...targets.flatMap((target) =>
    allowed[target].map(
      (method) =>
        [
          `${target}.${method}`,
          (seed: number) => Effect.map(valid(target, method, seed), (args) => ({ target, method, args })),
        ] as const,
    ),
  ),
  ...targets.map((target) => [`${target}:bad_row`, (seed: number) => spoiled(target, seed)] as const),
  ...targets.map(
    (target) =>
      [
        `${target}:unknown_method`,
        (seed: number) =>
          Effect.gen(function* () {
            const name = yield* sample(Other, seed);
            const method = allowedFor(target).has(name) ? "processObject" : name;
            return { target, method, args: yield* sample(JsonArgs, seed + 1) };
          }),
      ] as const,
  ),
  [
    "project.commit:reserved",
    (seed: number) =>
      Effect.gen(function* () {
        const args = yield* valid("project", "commit", seed);
        const process = yield* sample(Arbitrary.schema(Schema.String), seed + 1);
        const input = args[1];
        return {
          target: "project" as const,
          method: "commit",
          args: [args[0], { ...(Predicate.isObject(input) ? input : {}), process }, ...args.slice(2)],
        };
      }),
  ],
]);

const required = [...cases.keys()];

/** What the door must do with a request, from the arguments it received: which case it is, the
 *  refusal it answers or null, and the calls it makes. */
const oracle = Effect.fnUntraced(function* (
  { target, method }: Request,
  received: ReadonlyArray<unknown>,
  walk: typeof Walk.Type,
) {
  const payload = payloadFor(target, method);

  if (payload === undefined) {
    return { reached: `${target}:unknown_method`, refused: "unknown_method", calls: [] };
  }

  // A Project `commit` that names its own process is refused whatever else its arguments hold.
  if (target === "project" && method === "commit" && Predicate.hasProperty(received[1], "process")) {
    return { reached: "project.commit:reserved", refused: "reserved", calls: [] };
  }

  const decoded = yield* Effect.result(Schema.decodeUnknownEffect(payload)(received));

  if (Result.isFailure(decoded)) {
    return { reached: `${target}:bad_row`, refused: "bad_row", calls: [] };
  }

  const key =
    target === "project"
      ? walk.project
      : target === "process"
        ? JSON.stringify([walk.project, `object-of-${walk.name}`])
        : JSON.stringify([walk.project, walk.name]);
  return {
    reached: `${target}.${method}`,
    refused: null,
    calls: [{ target, key, method, args: decoded.success }],
  };
});

describe("L8: the control door calls only the method its request names", () => {
  it.effect.prop(
    "each allowed name reaches its own object once with the arguments its schema decoded; refused arguments, other names and a reserved commit call nothing",
    { walk: Walk },
    ({ walk }) =>
      Effect.gen(function* () {
        const { env, calls } = platform();
        const pending = new Set(required);
        // Enough steps for every case to come up, with room for samples that turn out to be another.
        const limit = required.length * 6 + walk.extra;
        let free = 0;

        for (let step = 0; step < limit && (pending.size > 0 || free < walk.extra); step++) {
          free += pending.size === 0 ? 1 : 0;
          const seed = walk.seed + step * 7;
          const category = yield* pick(pending.size > 0 ? [...pending] : required, seed);
          const build = cases.get(category)!;
          const request = yield* build(seed + 1);
          const body = yield* Schema.encodeUnknownEffect(Body)({
            target: request.target,
            project: walk.project,
            name: walk.name,
            method: request.method,
            args: request.args,
          });
          // The arguments as the door reads them out of the body: JSON's own form of the sent ones.
          const received = (yield* Schema.decodeUnknownEffect(Received)(body)).args;
          const expected = yield* oracle(request, received, walk);
          calls.length = 0;
          const { status, answer } = yield* ask(env, body);
          const reason = refusal(answer);
          const refused = reason !== undefined && REFUSALS.has(reason) ? reason : null;

          expect(
            { refused, status: refused === null ? null : status, calls },
            `${request.target}.${request.method}`,
          ).toEqual({
            refused: expected.refused,
            status: expected.refused === null ? null : 500,
            calls: expected.calls,
          });
          pending.delete(expected.reached);
        }

        expect([...pending], "cases the walk never reached").toEqual([]);
      }),
    { arbitrary: { seed: SEED, runs: runsFor({ fast: 30, full: 200 }) } },
  );
});
