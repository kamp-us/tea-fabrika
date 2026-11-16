/**
 * The built-in `pipe` Cmd: a program asks the brain to pipe one program's output to another
 * program's input, under the registered names it will start them by. The runner performs it, binds
 * who asks, and fills each end's code hash and declared shape from the loader; a program names only
 * the two ends (0551, 0553).
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Piped, PipeRefusal } from "../processes/Pipes.ts";

/** One end of a pipe: the registered name the asking program will start it under, its program, and
 *  the port. Nothing needs to run yet when the brain checks it. */
const Writer = Schema.Struct({ name: Schema.String, program: Schema.String, output: Schema.NonEmptyString });
const Reader = Schema.Struct({ name: Schema.String, program: Schema.String, input: Schema.NonEmptyString });

/**
 * Schema for a pipe Cmd's operands: its two ends. The runner binds who asks.
 *
 * @stability unstable
 * @category schemas
 */
export const PipeInput = Schema.Struct({ from: Writer, to: Reader });

const Asked = Schema.declare<typeof PipeInput.Type>(
  (value): value is typeof PipeInput.Type => typeof value === "object" && value !== null,
);

/**
 * The built-in pipe Cmd. It answers `pipe_ok` with `piped {pipe}` or `unfit {fit}`, or `pipe_err`
 * with a refusal.
 *
 * **Details**
 *
 * Its input is checked loosely, as `start_child`'s is, so a malformed Cmd is answered `bad_cmd` by
 * the runner and never fails the step that asked. A pipe is made before either end starts: a name
 * that is already live is `name_taken`.
 *
 * @stability unstable
 * @category constructors
 */
export const pipe = Cmd.make("pipe", { input: Asked, ok: Piped, err: PipeRefusal.literals });
