/**
 * What the `config` command prints for its reads: the listing of every setting, and the one line of a `get`. Each text is built whole before anything is printed, and ends in exactly one line break.
 */
import { Order, Schema } from "effect";
import * as Arr from "effect/Array";
import { Origin } from "../../Sources.ts";
import type { Settled } from "../read.ts";

/** An origin as a person reads it: `the default`, a variable's name, or `<file>, line <n>`. */
const from = (origin: Origin): string =>
  Origin.matchOrElse(
    origin,
    { file: ({ file, line }) => `${file}, line ${line}`, default: () => "the default" },
    ({ name }) => name,
  );

/** A value as one line of JSON, as its setting's codec writes it, so every break of a text is escaped and its bytes come back. */
const json = ({ setting, value }: Settled): string =>
  JSON.stringify(Schema.encodeSync(Schema.toCodecJson(setting.schema))(value));

/** `get`'s answer: the value as one line of JSON and a line break. */
export const line = (settled: Settled): string => `${json(settled)}\n`;

/** A description with the two-space indent after each of its breaks (LF, CRLF or a lone CR) but a final one. */
const indented = (text: string) => text.replace(/(\r\n|\r(?!\n)|\n)(?!$)/gu, "$1  ");

/** One setting's block: `<name> = <JSON>`, `from <origin>`, `live` or `restart` with `, file-only`, then its description. A final break of the description ends the block in place of the plain one. */
const block = (settled: Settled): string => {
  const { setting, origin } = settled;
  const marks = `${setting.live ? "live" : "restart"}${setting.fileOnly ? ", file-only" : ""}`;

  const head = [
    `${setting.name} = ${json(settled)}`,
    `  from ${from(origin)}`,
    `  ${marks}`,
    `  ${indented(setting.description)}`,
  ].join("\n");

  return /(\r\n|\r|\n)$/u.test(setting.description) ? head : `${head}\n`;
};

const byName = Order.mapInput(Order.String, ({ setting }: Settled) => setting.name);

/** Every block, by name, one blank line between. No settings: no text. */
export const listing = (settled: ReadonlyArray<Settled>): string => Arr.sort(settled, byName).map(block).join("\n");
