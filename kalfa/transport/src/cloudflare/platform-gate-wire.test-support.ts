// The words the laws of the platform's rules (M1 to M5) and the gateway they run against say to each other, on the stand-in and on
// real workerd alike: what a client tells the raw probe gateway (`PlatformLaws.test-support.ts`), and what the gateway answers and reports.
// The raw probe of R0 (`platform-wire.test-support.ts`) is another thing: it is a Durable Object with no gateway.
import { Schema } from "effect";
import { Attachment } from "./platform-wire.test-support.ts";

/**
 * What a client tells the gateway, as the text of a message: store a value as the socket's attachment; store one and change it after
 * the write; store a function; read the attachment back; hold the slot call until released; release it; answer at once; send `n`
 * frames; and close the socket.
 */
export const GateCommand = Schema.TaggedUnion({
  put: { value: Schema.Json },
  putMutated: { value: Schema.Json },
  putFunction: {},
  get: {},
  hold: {},
  release: {},
  ping: {},
  burst: { n: Schema.Int },
  close: { code: Schema.Int, reason: Schema.String },
});

/**
 * What the gateway says. `Reply` is the answer to a command, on the socket it came on: the wake token (made when the gateway's Layer was
 * built), the slot call's number in its wake, whether the socket object was new to the gateway, how many slot calls were running when it
 * answered, and the body. The other four are reports, on the sink: `upgrade` was called with these options (`null` for none); the
 * gateway closed the socket and then sent on it, and what the attachment held; the platform's close event; the platform's error event.
 */
export const GateReport = Schema.TaggedUnion({
  Reply: { wake: Schema.String, seq: Schema.Int, fresh: Schema.Boolean, active: Schema.Int, body: Schema.Json },
  Upgraded: { wake: Schema.String, options: Schema.NullOr(Schema.Json) },
  ClosedByServer: { wake: Schema.String, sent: Schema.NullOr(Schema.String), attachment: Attachment },
  CloseEvent: {
    wake: Schema.String,
    code: Schema.Int,
    reason: Schema.String,
    wasClean: Schema.Boolean,
    attachment: Attachment,
  },
  ErrorEvent: { wake: Schema.String, attachment: Attachment },
});

export const GateReportText = Schema.fromJsonString(GateReport);

export const GateCommandText = Schema.fromJsonString(GateCommand);
