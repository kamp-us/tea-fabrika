/**
 * The Record objects' layer over the Durable Object binding: each call of `RecordObjects` goes to
 * the stub of the part it names.
 */
import { Layer } from "effect";
import { RecordObjects } from "./ObjectCalls.ts";
import type { RecordShape } from "./objects.ts";

/**
 * Layer that provides `RecordObjects` over `stub`, which answers the Record object of each named part.
 *
 * @category layers
 */
export const layer = (stub: (object: string) => RecordShape): Layer.Layer<RecordObjects> =>
  Layer.succeed(RecordObjects, {
    write: (object, ...args) => stub(object).write(...args),
    read: (object, ...args) => stub(object).read(...args),
    content: (object, ...args) => stub(object).content(...args),
    deleteContent: (object, ...args) => stub(object).deleteContent(...args),
  });
