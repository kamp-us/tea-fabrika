/**
 * The built-in Send command: a program asks the host to mail JSON to a registered name. Its only
 * operands are the name and the message; the runner binds who sends it. `queued` means the letter
 * is saved and its recipient scheduled, never that it was answered.
 *
 * @stability unstable
 */
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { MailRefusal } from "../processes/ProgramMail.ts";

/**
 * Schema for the Send command's operands: `to`, the registered name to mail, and `m`, the JSON
 * message. A program gives nothing else; the runner binds who sends it.
 *
 * @stability unstable
 * @category schemas
 */
export const SendInput = Schema.Struct({ to: Schema.NonEmptyString, m: Schema.Json });

/**
 * Schema for the delivery receipt: the saved letter's ID.
 *
 * @stability unstable
 * @category schemas
 */
export const Queued = Schema.TaggedStruct("queued", { id: Schema.NonEmptyString });

/**
 * The Send command. The runner performs it itself; a caller-supplied handler never runs it.
 *
 * **Details**
 *
 * Its errors are the `MailRefusal` reasons, each final, and `full`: the recipient's inbox holds its
 * cap of unread letters, nothing was saved, and the program decides whether to send again later.
 *
 * @stability unstable
 * @category commands
 */
export const send = Cmd.make("send", { input: SendInput, ok: Queued, err: [...MailRefusal.literals, "full"] });

/**
 * Schema for the chunked send's operands: `to`, the registered name to mail, `as`, the reader's
 * input type each letter carries, and `items`, the list to cut.
 *
 * @stability unstable
 * @category schemas
 */
export const ChunksInput = Schema.Struct({
  to: Schema.NonEmptyString,
  as: Schema.NonEmptyString,
  items: Schema.Array(Schema.Json),
});

/**
 * Schema for a chunked send's receipt, after its last letter is saved: the send's id, which every
 * letter's `part.id` carries, and how many letters it took.
 *
 * @stability unstable
 * @category schemas
 */
export const Chunked = Schema.TaggedStruct("queued", {
  id: Schema.NonEmptyString,
  letters: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

/**
 * The chunked send: the runner cuts `items` into letters of at most `mail.chunk` bytes and
 * delivers them to `to` in order, as `Chunk.Chunk` letters of type `as`.
 *
 * **Details**
 *
 * While the recipient's inbox is full, the runner waits and tries again, as a blocked pipe writer
 * does, so `full` is never its answer. `too_big` means an item cannot fit one letter alone, or the
 * operands are over the input cap, and nothing was sent. A final refusal after some letters were
 * saved is the answer, and the reader's `Chunk.join` says that send is cut.
 *
 * @stability unstable
 * @category commands
 */
export const sendChunks = Cmd.make("send_chunks", {
  input: ChunksInput,
  ok: Chunked,
  err: [...MailRefusal.literals, "too_big"],
});
