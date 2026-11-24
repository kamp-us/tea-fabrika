// The words the probe Worker and its client say to each other (R0 and the real runs of the platform laws): what a client tells the
// object, what the object reports, and what a socket's attachment holds when it looks. It is a file of its own so the test reads
// the schemas without loading the Worker module, which reads its port from the environment when it is loaded.
import { Schema } from "effect";

/** What a client tells the object, as the text of a message on the `main` socket. */
export const Command = Schema.TaggedUnion({
  write: { value: Schema.Json },
  read: {},
  close: { code: Schema.Int, reason: Schema.String },
});

/** What a socket's attachment holds when the object looks: the value, nothing, or the platform threw. */
export const Attachment = Schema.TaggedUnion({
  kept: { value: Schema.Json },
  gone: {},
  threw: { name: Schema.String },
});

/**
 * What the object says. Each report carries `wake`, a token made when the object's instance was built, so a new token is
 * a new wake, and `seq`, the number of slot calls that instance has taken, so a later event has a larger one.
 *
 * - `Answered`: the answer to a `write` or `read`, on the `main` socket.
 * - `ClosedByServer`: after the object closed the socket on a `close` command, in that same call: what `send` threw
 *   (`null` when it did not throw) and what the attachment held.
 * - `CloseEvent`: the platform's close event (`webSocketClose`), whoever closed first.
 * - `ErrorEvent`: the platform's error event (`webSocketError`).
 */
export const Report = Schema.TaggedUnion({
  Answered: { wake: Schema.String, seq: Schema.Int, attachment: Attachment },
  ClosedByServer: { wake: Schema.String, seq: Schema.Int, sent: Schema.NullOr(Schema.String), attachment: Attachment },
  CloseEvent: {
    wake: Schema.String,
    seq: Schema.Int,
    code: Schema.Int,
    reason: Schema.String,
    wasClean: Schema.Boolean,
    attachment: Attachment,
  },
  ErrorEvent: { wake: Schema.String, seq: Schema.Int, attachment: Attachment },
});

/** One report as the text of a message. */
export const ReportText = Schema.fromJsonString(Report);
