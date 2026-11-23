/**
 * What the live Layer logs in as.
 *
 * **Details**
 *
 * A login is held, never checked: the live Layer reads it when a call is sent, not when the Layer is built.
 */
import { Data, type Redacted } from "effect";

/**
 * A plain token someone handed in, such as a person's own login. Nothing checks it when the Layer is built.
 *
 * @category models
 */
export class Token extends Data.TaggedClass("Token")<{ readonly token: Redacted.Redacted<string> }> {}

/**
 * What the live Layer logs in as. Only a plain token for now: an App, an installation and a user join it later.
 *
 * @category models
 */
export type Login = Token;
