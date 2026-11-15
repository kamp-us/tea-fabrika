/**
 * The built-in hands command: a program asks the hands it may use to run one closed command, and
 * gets one answer back. The runner saves it as a job request under the Cmd's own id and answers it
 * when the job's result is collected, or refuses it when the person set no `hands.target` or the
 * job saved under its id is another process's.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { Command, Result } from "../jobs/Job.ts";
import { Refusal } from "./HandsJobs.ts";

/**
 * Schema for the hands command's operand: one closed command, never shell text. The runner binds
 * who asks and which hands key the request targets.
 *
 * @stability unstable
 * @category schemas
 */
export const HandsInput = Schema.Struct({ command: Command });

/**
 * The hands command. The runner performs it itself; a caller-supplied handler never runs it. Its
 * answer is the job's checked `Result`, `no_hands` when no hands key is set, or `id_reused` when the
 * job saved under its id is not its process's.
 *
 * @stability unstable
 * @category commands
 */
export const hands = Cmd.make("hands", { input: HandsInput, ok: Result, err: Refusal.literals });
