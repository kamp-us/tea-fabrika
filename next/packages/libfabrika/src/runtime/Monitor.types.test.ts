// Program watch (docs/plan/quests/watch-PLAN.md), next/: law M12, the shapes. A program names only the
// registered name to watch and the ref to end; the runner binds the watcher and makes the ref, so no
// operand can name another recipient. Their answers are `monitor_ok`, `monitor_err` and `demonitor_ok`.
// The trusted `as` argument that lets a brain-side service write as the watcher stays off
// `ProcessCalls`, the shape a Process object reaches over RPC. The lead and CI run the compiler;
// Vitest does not typecheck, so the body holds type assertions only (0527).
// Plants: add `to` to `MonitorInput`, or `as` to `ProcessCalls`: tsc red.
import { expectTypeOf, it } from "@effect/vitest";
import type { From } from "../processes/Mailbox.ts";
import type { ProcessCalls } from "../processes/ProcessManager.ts";
import type * as Monitor from "./Monitor.ts";

it("type: M12 monitor takes only a name, demonitor only a ref, and ProcessCalls takes no trusted watcher", () => {
  // The operands a program writes: nothing past these keys.
  expectTypeOf<keyof typeof Monitor.MonitorInput.Type>().toEqualTypeOf<"name">();
  expectTypeOf<(typeof Monitor.MonitorInput.Type)["name"]>().toEqualTypeOf<string>();
  expectTypeOf<keyof typeof Monitor.DemonitorInput.Type>().toEqualTypeOf<"ref">();
  expectTypeOf<(typeof Monitor.DemonitorInput.Type)["ref"]>().toEqualTypeOf<string>();
  // The answer names the watch's ref, the life it binds and the name asked, and nothing else.
  expectTypeOf<keyof typeof Monitor.Monitored.Type>().toEqualTypeOf<"_tag" | "ref" | "process" | "name">();
  // The Cmds' names, so their answers arrive as monitor_ok, monitor_err and demonitor_ok.
  expectTypeOf<typeof Monitor.monitor.cmdType>().toEqualTypeOf<"monitor">();
  expectTypeOf<typeof Monitor.monitor.okType>().toEqualTypeOf<"monitor_ok">();
  expectTypeOf<typeof Monitor.monitor.errType>().toEqualTypeOf<"monitor_err">();
  expectTypeOf<typeof Monitor.demonitor.cmdType>().toEqualTypeOf<"demonitor">();
  expectTypeOf<typeof Monitor.demonitor.okType>().toEqualTypeOf<"demonitor_ok">();
  // A refusal is one of four reasons, each final.
  expectTypeOf<typeof Monitor.MonitorRefusal.Type>().toEqualTypeOf<
    "forbidden" | "stale_sender" | "no_name" | "bad_name"
  >();
  // A Cmd a program builds takes only its operands: `to`, `process` or `as` is a type error.
  expectTypeOf<Parameters<typeof Monitor.monitor>[0]>().toEqualTypeOf<typeof Monitor.MonitorInput.Type>();
  expectTypeOf<Parameters<typeof Monitor.demonitor>[0]>().toEqualTypeOf<typeof Monitor.DemonitorInput.Type>();
  expectTypeOf<ReturnType<typeof Monitor.monitor>["_tag"]>().toEqualTypeOf<"monitor">();
  // Across an RPC, a watch keeps the three-argument forms: no object can name another recipient.
  expectTypeOf<Parameters<ProcessCalls["monitor"]>>().toEqualTypeOf<[ref: string, process: string, from: From]>();
  expectTypeOf<Parameters<ProcessCalls["demonitor"]>>().toEqualTypeOf<[ref: string, from: From]>();
});
