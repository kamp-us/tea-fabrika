/**
 * The slot a fetch asks for a login, the login it holds, and the filler that gives none.
 *
 * **Details**
 *
 * The slot is a service the program picks a filler for at its top, by name. A fetch asks it once, with the URL git will use.
 */
import type { Option } from "effect";
import { Context, Effect, Layer, Schema } from "effect";
import * as Remote from "./Remote.ts";

// One line of text: no CR, LF or NUL, since git reads the first line of what a helper prints.
const Line = Schema.String.check(Schema.isPattern(/^[^\r\n\0]*$/));

/**
 * What git is handed to log in to a remote: a user name and a password.
 *
 * **Details**
 *
 * The password is `Redacted`, so it prints as `<redacted>`, and the JSON form refuses to hold it.
 *
 * @category models
 */
export class Credential extends Schema.Class<Credential, { readonly brand: unique symbol }>("@kalfa/git/Credential")({
  username: Line,
  password: Schema.Redacted(Line, { disallowJsonEncode: true }),
}) {}

/**
 * The slot could not give a credential for the URL.
 *
 * **Details**
 *
 * It holds the URL only, so no filler's detail and no secret rides in it.
 *
 * @category errors
 */
export class NoCredential extends Schema.TaggedError<NoCredential, { readonly brand: unique symbol }>()(
  "NoCredential",
  { url: Remote.Url },
) {}

/**
 * The slot: asked once on every fetch, with the URL git will use. `none` answers that no login is needed.
 *
 * @category services
 */
export class Credentials extends Context.Service<
  Credentials,
  { readonly ask: (url: Remote.Url) => Effect.Effect<Option.Option<Credential>, NoCredential> }
>()("@kalfa/git/Credentials") {}

/**
 * The filler that gives no credential, for a remote that needs no login: a local path, a remote in memory or a public one.
 *
 * @category layers
 */
export const none: Layer.Layer<Credentials> = Layer.succeed(Credentials)({ ask: () => Effect.succeedNone });
