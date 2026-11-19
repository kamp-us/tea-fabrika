/**
 * The Process objects' layer over the Durable Object binding: each call of `ProcessObjects` goes to
 * the stub of the object it names, through `ProcessClient`.
 */
import { Layer } from "effect";
import type { ProcessBinding } from "./bindings.ts";
import { ProcessObjects } from "./ObjectCalls.ts";
import { ProcessClient } from "./platform.ts";

/**
 * Layer that provides `ProcessObjects` over `stub`, which answers the binding of each named object.
 *
 * @category layers
 */
export const layer = (stub: (object: string) => ProcessBinding): Layer.Layer<ProcessObjects> =>
  Layer.succeed(ProcessObjects, {
    swap: (object, ...args) => ProcessClient.make(stub(object)).swap(...args),
    usage: (object, ...args) => ProcessClient.make(stub(object)).usage(...args),
    mailed: (object, ...args) => ProcessClient.make(stub(object)).mailed(...args),
    configure: (object, ...args) => ProcessClient.make(stub(object)).configure(...args),
    descriptor: (object, ...args) => ProcessClient.make(stub(object)).descriptor(...args),
    msg: (object, ...args) => ProcessClient.make(stub(object)).msg(...args),
    open: (object, ...args) => ProcessClient.make(stub(object)).open(...args),
    due: (object, ...args) => ProcessClient.make(stub(object)).due(...args),
    restart: (object, ...args) => ProcessClient.make(stub(object)).restart(...args),
    activity: (object, ...args) => ProcessClient.make(stub(object)).activity(...args),
    recover: (object) => ProcessClient.make(stub(object)).recover(),
    savedAlarm: (object) => ProcessClient.make(stub(object)).savedAlarm(),
    abort: (object) => ProcessClient.make(stub(object)).abort(),
  });
