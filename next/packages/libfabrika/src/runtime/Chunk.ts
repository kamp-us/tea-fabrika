/**
 * Chunk letters: a large list goes to its reader as letters of at most `mail.chunk` bytes, in
 * order. Each letter carries its `part`, and the reader tells a whole send from a cut one by
 * `last`, as a WebSocket frame's FIN flag marks a message's final frame (RFC 6455, section 5.4).
 *
 * @stability unstable
 */
import type * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Schema for a chunk letter's place in its send.
 *
 * @stability unstable
 * @category schemas
 */
export const Part = Schema.Struct({
  /** The send it belongs to: the `send_chunks` command's id. */
  id: Schema.NonEmptyString,
  /** Its place in that send, from 0. */
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** True on the send's final letter. */
  last: Schema.Boolean,
});

/**
 * Schema for one letter of a chunked send: the reader's input `type`, its share of the items, and
 * its part.
 *
 * @stability unstable
 * @category schemas
 */
export const Chunk = Schema.Struct({ type: Schema.NonEmptyString, items: Schema.Array(Schema.Json), part: Part });

/**
 * Returns the reader's typed input for one chunked port: letters of `type` whose items decode
 * with `item`.
 *
 * @stability unstable
 * @category schemas
 */
export const input = <const T extends string, S extends Schema.Top>(type: T, item: S) =>
  Schema.Struct({ type: Schema.Literal(type), items: Schema.Array(item), part: Part });

/**
 * Error for an item whose letter alone is over the chunk size, so the send cannot be cut.
 *
 * **Details**
 *
 * `index` is the item's place in the send, and `bytes` the size of its letter alone. For an empty
 * send, whose one letter's own fields are over the size, `index` is 0.
 *
 * @stability unstable
 * @category errors
 */
export class TooBig extends Schema.TaggedError<TooBig>()("TooBig", { index: Schema.Int, bytes: Schema.Int }) {}

type Send = { readonly id: string; readonly type: string; readonly items: ReadonlyArray<Schema.Json> };
type Chunk = typeof Chunk.Type;

const encoder = new TextEncoder();
const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

/**
 * Cuts a send's items into chunks whose encoded JSON is at most `size` bytes each, in order.
 *
 * **Details**
 *
 * Each chunk takes as many of the next items as fit. An empty list is one chunk with no items. An
 * item that cannot fit alone fails the whole cut with `TooBig`, and nothing is cut.
 *
 * @stability unstable
 * @category constructors
 */
export const cut = (send: Send, size: number): Result.Result<Arr.NonEmptyReadonlyArray<Chunk>, TooBig> => {
  const letter = (items: ReadonlyArray<Schema.Json>, seq: number, last: boolean): Chunk => ({
    type: send.type,
    items,
    part: { id: send.id, seq, last },
  });
  const sizes = send.items.map(bytes);
  const end = send.items.length;
  /** The chunk at `seq` that starts at item `from` and takes as many items as fit, and where it stops. */
  const take = (from: number, seq: number): Result.Result<{ readonly chunk: Chunk; readonly to: number }, TooBig> => {
    // A letter's bytes are its own fields, each item, and a comma between two items. It is the
    // send's last only when it takes the final item, and `true` is a byte shorter than `false`.
    const fields = { last: bytes(letter([], seq, true)), other: bytes(letter([], seq, false)) };
    const weigh = (to: number, load: number) => (to === end ? fields.last : fields.other) + load;
    let to = from;
    let load = 0;

    for (; to < end; to++) {
      const more = load + (sizes[to] ?? 0) + (to > from ? 1 : 0);

      if (weigh(to + 1, more) > size) {
        break;
      }

      load = more;
    }

    if (to > from || (end === 0 && fields.last <= size)) {
      return Result.succeed({ chunk: letter(send.items.slice(from, to), seq, to === end), to });
    }

    // Nothing fit: the next item alone is over the size, or an empty send's own fields are.
    return Result.fail(new TooBig({ index: from, bytes: weigh(Math.min(from + 1, end), sizes[from] ?? 0) }));
  };
  const first = take(0, 0);

  if (Result.isFailure(first)) {
    return Result.fail(first.failure);
  }

  const chunks: [Chunk, ...Array<Chunk>] = [first.success.chunk];

  for (let from = first.success.to; from < end;) {
    const next = take(from, chunks.length);

    if (Result.isFailure(next)) {
      return Result.fail(next.failure);
    }

    chunks.push(next.success.chunk);
    from = next.success.to;
  }

  return Result.succeed(chunks);
};

/**
 * Joins chunks back into their send's items.
 *
 * **Details**
 *
 * The answer is the items, in order, only when the chunks are one send's seq 0 to n, each once and
 * in order, with `last` on n alone. Anything else is a cut send so far, and the answer is none.
 *
 * @stability unstable
 * @category combinators
 */
export const join = (chunks: ReadonlyArray<Chunk>): Option.Option<ReadonlyArray<Schema.Json>> => {
  const id = chunks[0]?.part.id;
  const whole =
    id !== undefined &&
    chunks.every(
      (chunk, n) => chunk.part.id === id && chunk.part.seq === n && chunk.part.last === (n === chunks.length - 1),
    );
  return whole ? Option.some(chunks.flatMap((chunk) => chunk.items)) : Option.none();
};
