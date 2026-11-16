/**
 * What a reader declares for one pipe: the Msg its piped input is handed, and its two input ports.
 * The program names the shape it means, list or not, and nothing here names how the pipe carries it
 * (0553): the reader's runner hands the program one `{type, value}` per whole value, as an Elm port
 * hands `update` one typed value.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/**
 * The Msg case a piped input is handed: the value, in the shape the reader declares.
 *
 * @stability unstable
 * @category constructors
 */
export const input = <const T extends string, S extends Schema.Codec<unknown, unknown>>(type: T, shape: S) =>
  Schema.Struct({ type: Schema.Literal(type), value: shape });

/**
 * The two input ports a reader declares for one pipe.
 *
 * @stability unstable
 * @category models
 */
export type Ports<T extends string, S> = { readonly [K in T]: { readonly description: string; readonly value: S } } & {
  readonly DOWN: string;
};

/**
 * The two input ports a reader declares for one pipe: the value input under `type`, a plain write
 * port that also names its declared shape, and the `DOWN` input each writer life's end arrives on.
 *
 * **Details**
 *
 * A `{type, value}` message a person or client sends to the value input steps the program as any
 * write port does; the pipe is one more way that Msg arrives.
 *
 * @stability unstable
 * @category constructors
 */
export const ports = <const T extends string, S extends Schema.Codec<unknown, unknown>>(
  type: T,
  shape: S,
  description: string,
): Ports<T, S> =>
  // TypeScript types a computed key of a generic `T` as a string index (microsoft/TypeScript#13948),
  // so the object is named by its type here, once.
  ({
    [type]: { description, value: shape },
    DOWN: "A program piped into this one has ended",
  }) as Ports<T, S>;
