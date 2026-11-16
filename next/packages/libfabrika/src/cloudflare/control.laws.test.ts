// L8 of the Reflect ban (docs/plan/quests/reflect-ban-PLAN.md, slice 10; decision 0554), next/.
// The control door calls exactly the method its request names, on the object its request names,
// with the arguments it decoded from the request, and it refuses any other name with
// `unknown_method` before it calls anything. Only the platform is fake: each Durable Object
// namespace hands out a `Stub.make` stub that writes down every call it is given and then rejects
// it, so the real door, the real clients and `rpc` run on it.
//
// The allowed names are the door's documented sets (control.ts's doc block: "Only the listed methods
// of each target are called"), written out here as the law's own oracle, so a name the door drops
// or adds fails the law. A method its client calls with nothing (`info`, `recover`, ...) is given
// nothing, whatever the request carried.
//
// Plant: drop one key from the door's table (today the `methods` sets, after the build its typed
// table): L8 red for that method.
import { Stub } from "@kampus/vitest";
import { Effect, Predicate, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { ProcessBinding, ProjectBinding, RecordBinding } from "./bindings.ts";
import { control } from "./control.ts";
import type { Env } from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

const SEED = 119120;

/** The door's Response body did not read. */
class Unread extends Schema.TaggedError<Unread>()("Unread", { cause: Schema.Defect() }) {}
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

/** The methods whose client calls the object with no arguments. */
const takesNothing = new Set(["clientConnect", "info", "recover", "savedAlarm", "abort"]);

const allowedFor = (target: Target): ReadonlySet<string> => new Set(allowed[target]);

/** Names a door must refuse: real members it does not list, another target's names, an object's
 *  own keys, and any string. */
const others = fc.oneof(
  fc.constantFrom(
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
  ),
  fc.string(),
);

const Args = Schema.fromJsonString(Schema.Array(Schema.Unknown));

const request = fc.oneof(
  fc
    .constantFrom(...targets.flatMap((target) => allowed[target].map((method) => ({ target, method }))))
    .chain(({ target, method }) =>
      fc.record({ target: fc.constant(target), method: fc.constant(method), args: fc.array(fc.jsonValue()) }),
    ),
  fc.constantFrom(...targets).chain((target) =>
    fc.record({
      target: fc.constant(target),
      method: others.filter((method) => !allowedFor(target).has(method)),
      args: fc.array(fc.jsonValue()),
    }),
  ),
);

/** The door's answer: a value, or a failure's reason. */
const Answer = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ value: Schema.Unknown }),
    Schema.Struct({ error: Schema.Struct({ reason: Schema.String }) }),
  ]),
);

/** One call a stub was given: which object, by which namespace key, which method and what arguments. */
type Call = { readonly target: Target; readonly key: string; readonly method: string; readonly args: unknown };

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

const ask = (env: Env, body: unknown) =>
  Effect.gen(function* () {
    const response = yield* control(
      new Request("http://127.0.0.1/control", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      }),
      env,
      Redacted.make(TOKEN),
      {},
    );
    const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (cause) => new Unread({ cause }) });
    return { status: response.status, answer: Schema.decodeUnknownSync(Answer)(text) };
  });

/** The reason a failure answer gives, or undefined for a value. */
const refusal = (answer: typeof Answer.Type) => ("error" in answer ? answer.error.reason : undefined);

describe("L8: the control door calls only the method its request names", () => {
  it("each allowed name reaches its own object with the decoded arguments; any other name is refused before a call", async () => {
    const reached = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          project: fc.string(),
          name: fc.string(),
          requests: fc.array(request, { minLength: 1, maxLength: 12 }),
        }),
        ({ project, name, requests }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { env, calls } = platform();

              for (const { target, method, args } of requests) {
                calls.length = 0;
                const { status, answer } = yield* ask(env, { target, project, name, method, args });
                // What the door decoded from the body: JSON's own form of the generated arguments.
                const decoded = Schema.decodeUnknownSync(Args)(JSON.stringify(args));

                if (!allowedFor(target).has(method)) {
                  reached.add(`${target}:refused`);
                  expect(calls, `${target}.${method} reaches no object`).toEqual([]);
                  expect(status).toBe(500);
                  expect(refusal(answer)).toBe("unknown_method");
                  continue;
                }

                reached.add(`${target}.${method}`);
                expect(refusal(answer), `${target}.${method} is a name the door calls`).not.toBe("unknown_method");

                if (target === "project" && method === "commit" && Predicate.hasProperty(decoded[1], "process")) {
                  // A Project `commit` that names its own process is refused, and calls nothing.
                  expect(calls).toEqual([]);
                  expect(refusal(answer)).toBe("reserved");
                  continue;
                }

                // At most one call, and only of the named method on the named object. A door that
                // refuses arguments its decoder does not take calls nothing.
                expect(calls.length).toBeLessThanOrEqual(1);

                for (const call of calls) {
                  reached.add(`${target}:called`);
                  expect(call).toEqual({
                    target,
                    key:
                      target === "project"
                        ? project
                        : target === "process"
                          ? JSON.stringify([project, `object-of-${name}`])
                          : JSON.stringify([project, name]),
                    method,
                    args: takesNothing.has(method) ? [] : decoded,
                  });
                }
              }
            }),
          ),
      ),
      { seed: SEED, numRuns: 200 },
    );

    // Coverage: every allowed name was asked for, each target refused some name, and each target's
    // object was really called, so no case of the law went unwalked.
    const required = [
      ...targets.flatMap((target) => allowed[target].map((method) => `${target}.${method}`)),
      ...targets.map((target) => `${target}:refused`),
      ...targets.map((target) => `${target}:called`),
    ];
    expect(
      required.filter((key) => !reached.has(key)),
      "cases the generator never reached",
    ).toEqual([]);
  });
});
