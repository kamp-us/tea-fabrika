/**
 * The calls the Project makes on its Process and Record objects, as two Effect services: each call
 * takes the registered name of the object it goes to first, as OTP's `gen_server:call(Name, Request)`
 * does. A law provides each with `Recorder.layer`; the live Worker provides them over the bindings
 * (`ProcessObjectsRpc.ts` and `RecordObjectsRpc.ts`).
 */
import { Context } from "effect";
import type { RecordShape } from "./objects.ts";
import type { ProcessClient } from "./platform.ts";

/** Each call of `S`, with the registered name of the object it goes to put first. */
type ByName<S> = {
  readonly [K in keyof S]: S[K] extends (...args: infer A) => infer R ? (object: string, ...args: A) => R : never;
};

/**
 * Service for one project's Process objects, called by registered name.
 *
 * @category services
 */
export class ProcessObjects extends Context.Service<ProcessObjects, ByName<ProcessClient["Service"]>>()(
  "@kampus/libfabrika/cloudflare/ObjectCalls.ProcessObjects",
) {}

/**
 * Service for one project's Record objects, called by part name.
 *
 * @category services
 */
export class RecordObjects extends Context.Service<RecordObjects, ByName<RecordShape>>()(
  "@kampus/libfabrika/cloudflare/ObjectCalls.RecordObjects",
) {}
