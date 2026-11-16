// Ticket 1056, next/: L7 of the Reflect ban plan (docs/plan/quests/reflect-ban-PLAN.md, amendment of
// 2026-11-15), written before the build. The local dev client names its methods: `startDev`'s
// `project(p)` and `process(pid)` answer the calls the control door allows, each with the argument
// types the Project and Process bindings give, and a name the door refuses is a type error. tsc
// checks this file (the lead's typecheck); vitest only loads it.
//
// The contract this law pins:
//   node/dev/dev.ts: `project(p)` has exactly the door's Project names, with `connect` for
//     `clientConnect`, plus `gateways` (join, leave, online) and `forProcess(pid).append` for
//     `commit(pid, ...)`. `process(pid)` has exactly the door's Process names, plus `alarm` for
//     `savedAlarm`. Each call takes the binding's arguments and answers a Promise of the binding's
//     answer or a wider one, such as `Promise<unknown>` for a reply that crossed JSON undecoded.
// The door's names are written here from `methods` in cloudflare/control.ts:31, which exports
// nothing; slice 10's typed table replaces that set, and this law then reads the table's keys.
//
// Plants (after build, run at review): type the client as the bare record of functions again, and
// every check below is red; drop `restart` from `DevProcess`'s `Pick`, and the Process keys are red.
import { describe, expectTypeOf, it } from "@effect/vitest";
import type { Effect } from "effect";
import type { ProcessBinding, ProjectBinding } from "../../cloudflare/bindings.ts";
import type { startDev } from "./dev.ts";

type Dev = Effect.Success<ReturnType<typeof startDev>>;
type Project = ReturnType<Dev["project"]>;
type Process = ReturnType<Dev["process"]>;

/** The control door's Project names, `methods.project` in cloudflare/control.ts. */
type DoorProject =
  | "clientConnect"
  | "challenge"
  | "initialize"
  | "route"
  | "grant"
  | "read"
  | "append"
  | "wait"
  | "start"
  | "exit"
  | "info"
  | "sign"
  | "commit"
  | "join"
  | "leave"
  | "online"
  | "brain"
  | "codeInstall"
  | "codeFailed";

/** The control door's Process names, `methods.process` in cloudflare/control.ts. */
type DoorProcess = "msg" | "open" | "due" | "restart" | "abort" | "activity" | "recover" | "savedAlarm";

/** The names the dev client and the binding share, spelled the same. */
type SameProject = Exclude<DoorProject, "clientConnect">;

/** Each call's arguments, with no readonly or optional mark on the member, so two sides compare by the call alone. */
type Args<T> = { -readonly [K in keyof T]-?: T[K] extends (...args: infer A) => unknown ? A : never };

/** Each call's answer. */
type Answers<T> = { -readonly [K in keyof T]-?: T[K] extends (...args: never) => infer B ? B : never };

/** A call's arguments after its first, the process ID that `forProcess` puts in front. */
type Rest<F> = F extends (first: never, ...rest: infer R) => unknown ? R : never;

type Gateways = Project["gateways"];
type ForProcess = ReturnType<Project["forProcess"]>;

describe("Reflect ban L7: the dev client names its methods", () => {
  it("type: project(p) has exactly the door's Project names, each with the binding's arguments and a Promise of its answer or wider", () => {
    expectTypeOf<keyof Project>().toEqualTypeOf<SameProject | "connect" | "gateways" | "forProcess">();
    expectTypeOf<Project["start"]>().toBeFunction();
    expectTypeOf<Args<Pick<Project, SameProject>>>().toEqualTypeOf<Args<Pick<ProjectBinding, SameProject>>>();
    expectTypeOf<Answers<Pick<Project, SameProject>>>().toExtend<Record<SameProject, Promise<unknown>>>();
    expectTypeOf<Answers<Pick<ProjectBinding, SameProject>>>().toExtend<Answers<Pick<Project, SameProject>>>();
    // `connect` is `clientConnect`, renamed by the client.
    expectTypeOf<Parameters<Project["connect"]>>().toEqualTypeOf<Parameters<ProjectBinding["clientConnect"]>>();
    expectTypeOf<ReturnType<ProjectBinding["clientConnect"]>>().toExtend<ReturnType<Project["connect"]>>();
    // @ts-expect-error processStart is a binding call the control door refuses, so the client has none
    expectTypeOf<Project>().toHaveProperty("processStart");
  });

  it("type: gateways and forProcess(pid).append are the binding's join, leave, online and commit", () => {
    expectTypeOf<keyof Gateways>().toEqualTypeOf<"join" | "leave" | "online">();
    expectTypeOf<Args<Gateways>>().toEqualTypeOf<Args<Pick<ProjectBinding, "join" | "leave" | "online">>>();
    expectTypeOf<Answers<Pick<ProjectBinding, "join" | "leave" | "online">>>().toExtend<Answers<Gateways>>();
    expectTypeOf<Parameters<Project["forProcess"]>>().toEqualTypeOf<[Parameters<ProjectBinding["commit"]>[0]]>();
    expectTypeOf<keyof ForProcess>().toEqualTypeOf<"append">();
    expectTypeOf<Parameters<ForProcess["append"]>>().toEqualTypeOf<Rest<ProjectBinding["commit"]>>();
    expectTypeOf<ReturnType<ProjectBinding["commit"]>>().toExtend<ReturnType<ForProcess["append"]>>();
  });

  it("type: process(pid) has exactly the door's Process names and alarm, each with the binding's arguments and a Promise of its answer or wider", () => {
    expectTypeOf<keyof Process>().toEqualTypeOf<DoorProcess | "alarm">();
    expectTypeOf<Process["restart"]>().toBeFunction();
    expectTypeOf<Args<Pick<Process, DoorProcess>>>().toEqualTypeOf<Args<Pick<ProcessBinding, DoorProcess>>>();
    expectTypeOf<Answers<Pick<Process, DoorProcess>>>().toExtend<Record<DoorProcess, Promise<unknown>>>();
    expectTypeOf<Answers<Pick<ProcessBinding, DoorProcess>>>().toExtend<Answers<Pick<Process, DoorProcess>>>();
    // `alarm` is `savedAlarm`, renamed by the client.
    expectTypeOf<Parameters<Process["alarm"]>>().toEqualTypeOf<Parameters<ProcessBinding["savedAlarm"]>>();
    expectTypeOf<ReturnType<ProcessBinding["savedAlarm"]>>().toExtend<ReturnType<Process["alarm"]>>();
    // @ts-expect-error ping is no call of a Process, and the client grows none for the control laws' fake
    expectTypeOf<Process>().toHaveProperty("ping");
  });
});
