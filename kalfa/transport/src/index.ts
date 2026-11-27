/**
 * The root entry of `@kalfa/transport`: move typed values over a socket as frames, and read them back with the sender's trace.
 */

/**
 * The stream functions: `encode`, `decode`, `encodeTraced`, `decodeTraced` and `socket`.
 *
 * @category streams
 */
export * as Transport from "./Transport.ts";

export {
  /**
   * @category services
   */
  Format,
  /**
   * @category errors
   */
  FormatError,
  /**
   * @category services
   */
  TraceState,
} from "./Format.ts";

export {
  /**
   * @category errors
   */
  NoSharedVersion,
} from "./Hello.ts";

export type {
  /**
   * @category models
   */
  Answer,
  /**
   * @category models
   */
  Connected,
  /**
   * @category models
   */
  Hello,
} from "./Hello.ts";

export type {
  /**
   * @category models
   */
  Frame,
} from "./Frame.ts";

export type {
  /**
   * @category models
   */
  Traced,
} from "./Traced.ts";
