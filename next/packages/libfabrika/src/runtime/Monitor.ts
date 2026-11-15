/**
 * The built-in monitor and demonitor commands, OTP's `monitor(process, Name)` and
 * `demonitor(Ref, [flush])`: a program watches another process by its registered name and gets one
 * `DOWN` when that life ends, and ends a watch it no longer needs. Their only operands are these;
 * the runner binds the watcher, and the Cmd's own id is the watch's ref.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Watched } from "../processes/Monitors.ts";

/**
 * Schema for the monitor operands: the registered `name` to watch. It is a plain string, so the
 * host judges it once: a name that is not a process name is `bad_name`.
 *
 * @stability unstable
 * @category schemas
 */
export const MonitorInput = Schema.Struct({ name: Schema.String });

/**
 * Schema for monitor's answer: the watch's `ref`, which is the Cmd's own id, the `process` it binds
 * and the `name` asked. A `DOWN` for this watch carries the same ref and name.
 *
 * @stability unstable
 * @category schemas
 */
export const Monitored = Schema.TaggedStruct("monitored", Watched.fields);

/**
 * Schema for the reasons a watch is refused, as `monitor` declares them. Each is final, and a
 * refusal writes nothing. A malformed watch is answered `bad_cmd`, which is not one of these.
 *
 * @stability unstable
 * @category schemas
 */
export const MonitorRefusal = Schema.Literals(["forbidden", "stale_sender", "no_name", "bad_name"]);

/** What a step's own check takes: any object, typed as the operands. The host decodes it strictly,
 *  so a malformed watch is answered `bad_cmd` and never fails the step that asked for it. */
const Asked = Schema.declare<typeof MonitorInput.Type>(
  (value): value is typeof MonitorInput.Type => typeof value === "object" && value !== null,
);

/**
 * The monitor command. The runner performs it itself: the brain answers it in the watch's own turn,
 * so its answer always folds before the watch's `DOWN`. A program that declares it must declare a
 * `DOWN` input, where that `DOWN` arrives.
 *
 * @stability unstable
 * @category commands
 */
export const monitor = Cmd.make("monitor", { input: Asked, ok: Monitored, err: MonitorRefusal.literals });

/**
 * Schema for the demonitor operands: a `ref` this life got from `monitor`.
 *
 * @stability unstable
 * @category schemas
 */
export const DemonitorInput = Schema.Struct({ ref: Schema.String });

/** What a step's own check takes for a demonitor: any object, as for a monitor. */
const AskedRef = Schema.declare<typeof DemonitorInput.Type>(
  (value): value is typeof DemonitorInput.Type => typeof value === "object" && value !== null,
);

/**
 * The demonitor command: this life's watch under `ref` ends, and no `DOWN` for it folds after, one
 * already in the inbox included. A ref this life never got, or another life's, changes nothing and
 * is answered `ok` too, as OTP's `demonitor` is.
 *
 * @stability unstable
 * @category commands
 */
export const demonitor = Cmd.make("demonitor", { input: AskedRef, ok: Schema.Null, err: [] });
