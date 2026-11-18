/**
 * What a client's sockets are told: a view update from a watched process, a grant, or a close. The
 * runner makes the update, the gateway makes the grant and the close, and the cloud objects carry
 * all three to the Connection object, which decodes them once and sends each one to the socket.
 */
import { Schema } from "effect";
import { Patch } from "./Patch.ts";

/**
 * Schema for a view as JSON. One runner serves every program, so the shape stays open: each
 * program's own client decodes its view.
 *
 * @category schemas
 */
export const View = Schema.Json;
/**
 * A view as JSON, as `View` decodes it.
 *
 * @category models
 */
export type View = typeof View.Type;

const whole = { type: Schema.Literal("whole"), rev: Schema.Number, view: View };
const patch = { type: Schema.Literal("patch"), base: Schema.Number, rev: Schema.Number, patch: Schema.Array(Patch) };

/**
 * Schema for what a watcher is sent: the whole view once, then one patch per installed step. `rev`
 * is the inbox position of the last installed letter, so other streams leave no gaps. Its cases are
 * told apart by `type`, the key every client reads on the wire today.
 *
 * @category schemas
 */
export const Update = Schema.Union([Schema.Struct(whole), Schema.Struct(patch)]);
/**
 * One view update, as `Update` decodes it.
 *
 * @category models
 */
export type Update = typeof Update.Type;

/**
 * Schema for a view update on its way to one client: an `Update` with the pid of the process it
 * came from, so the client finds the tile it belongs to.
 *
 * @category schemas
 */
export const Published = Schema.Union([
  Schema.Struct({ ...whole, pid: Schema.String }),
  Schema.Struct({ ...patch, pid: Schema.String }),
]);
/**
 * One view update with its pid, as `Published` decodes it.
 *
 * @category models
 */
export type Published = typeof Published.Type;

/**
 * Schema for what the brain tells one client's sockets. `close` closes them with a private-use code
 * (RFC 6455, 7.4.2), 4003 when the client's key was removed. `granted` hands a waiting client the
 * nonce to sign. `view` carries one view update.
 *
 * @category schemas
 */
export const News = Schema.TaggedUnion({
  close: { code: Schema.Int.check(Schema.isBetween({ minimum: 4000, maximum: 4999 })) },
  granted: { nonce: Schema.String },
  view: { update: Published },
});
/**
 * One piece of news for a client, as `News` decodes it.
 *
 * @category models
 */
export type News = typeof News.Type;
