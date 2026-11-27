// What the laws of `Hidden` (Hidden.ts) share: the causes a hidden cause is made over, the values a read may meet in the cause's place, the raw values
// a run-time guard must refuse, the forms a drawn word is written in elsewhere, and `written`, every text a codec gives for an error. Each law applies
// every class to each value it draws, so every class is reached in every run and no run can pass on less.
import { Arbitrary, Array as Arr, Exit, Formatter, Predicate, Redacted, Result, Schema } from "effect";
import { Base64, Base64Url, Hex } from "effect/encoding";
import { between, SEED } from "./Diagnostic.test-support.ts";

export { SEED };

/** One of the choices. */
const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

const LOWER = [..."abcdefghijklmnopqrstuvwxyz"];

const ALNUM_ANY_CASE = [...LOWER, ..."0123456789", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** A word a test must not be able to hide from a search: a text a drawn label or number cannot hold by chance. */
const marker: Arbitrary.Arbitrary<string> = Arbitrary.array(pick(ALNUM_ANY_CASE), {
  minLength: 8,
  maxLength: 12,
}).pipe(Arbitrary.map((chars) => `qz9${chars.join("")}`));

/** A label for a hidden cause: letters only, so no search for a word can find it. */
const label: Arbitrary.Arbitrary<string> = Arbitrary.array(pick(LOWER), { minLength: 3, maxLength: 8 }).pipe(
  Arbitrary.map((chars) => chars.join("")),
);

/** What every law draws once: the word the causes quote, a label, the form a labeled cause is made over, a count and a number. */
export const hiddenCauses = Arbitrary.all({
  word: marker,
  label,
  form: pick(["e", "t", "r"] as const),
  count: between(0, 1000),
});

type Texture = typeof hiddenCauses extends Arbitrary.Arbitrary<infer A> ? A : never;

/** A cause that quotes the word, as a store's own client makes one: an error, a text, or a record that holds the word two levels down. */
type Quoted = Error | string | { readonly reason: string; readonly nested: { readonly reason: string } };

/** A cause a hidden cause is made over, the class it is of, and the plain value inside. */
interface Made {
  readonly id: "e" | "t" | "r" | "l" | "u";
  readonly plain: Quoted | undefined;
  readonly hidden: Redacted.Redacted<Quoted | undefined>;
}

/** What a codec writes: a JSON value, or the string tree the string codec writes. */
type Written = Schema.Json | Schema.StringTree;

/** What a codec writes for an error, as a record of its keys. */
type WireRecord = Readonly<Record<string, unknown>>;

/** An `Error` whose message quotes the word, whose cause is an `Error` that quotes it, whose cause is the word. */
const quoting = (word: string): Error =>
  new Error(`bad value ${word}`, { cause: new Error(`nested ${word}`, { cause: word }) });

/** The three plain causes: the plan's (e), (t) and (r). */
const plainCauses = (word: string): Readonly<Record<"e" | "t" | "r", Quoted>> => ({
  e: quoting(word),
  t: word,
  r: { reason: word, nested: { reason: word } },
});

/** The hidden causes of every class (e), (t), (r), (l) and (u), each made from the texture. */
export const causeClasses = (texture: Texture): ReadonlyArray<Made> => {
  const plain = plainCauses(texture.word);

  return [
    { id: "e", plain: plain.e, hidden: Redacted.make(plain.e) },
    { id: "t", plain: plain.t, hidden: Redacted.make(plain.t) },
    { id: "r", plain: plain.r, hidden: Redacted.make(plain.r) },
    { id: "l", plain: plain[texture.form], hidden: Redacted.make(plain[texture.form], { label: texture.label }) },
    { id: "u", plain: undefined, hidden: Redacted.make(undefined) },
  ];
};

/** The classes of a list, in order, as one word: a law checks it so a class cannot go missing unseen. */
export const classIds = (made: ReadonlyArray<Made>): string => made.map((each) => each.id).join("");

/** The causes that quote the word: every class but the empty one. */
export const quotingClasses = (made: ReadonlyArray<Made>): ReadonlyArray<Made> =>
  made.filter((each) => each.id !== "u");

/** A value on the wire in the cause's place, and a name for it, so a failure says which. */
interface Wire {
  readonly id: string;
  readonly value: Schema.Json;
}

/** Every JSON value that is not the placeholder, as the plan's (w) lists them. The placeholder is written out here, so this file stays true if it is changed. */
export const wireValues = (texture: Texture): ReadonlyArray<Wire> => [
  { id: "the word", value: texture.word },
  { id: "a labeled placeholder", value: `<redacted:${texture.label}>` },
  { id: "the placeholder with a space before it", value: " <redacted>" },
  { id: "the placeholder with a space after it", value: "<redacted> " },
  { id: "null", value: null },
  { id: "a number", value: texture.count },
  { id: "an error's name and message", value: { name: "Error", message: texture.word } },
];

/** An object that looks like a hidden value: its text is the placeholder. */
export const lookAlike = { toString: () => "<redacted>" };

// ---- the forms a word is written in elsewhere, and a search for them

/** The forms a text is written in elsewhere: as it is, as JSON text holds it, in base64, in base64url, in hex, and percent-encoded. */
const forms = (text: string): ReadonlyArray<string> => [
  text,
  JSON.stringify(text).slice(1, -1),
  Base64.encode(text),
  Base64Url.encode(text),
  Hex.encode(text),
  encodeURIComponent(text),
];

/** The base64 text a word makes inside a longer text, at each of the three alignments a writer meets it. */
const inside = (core: string, encode: (input: string) => string): ReadonlyArray<string> =>
  [0, 1, 2].map((offset) => encode(`${"A".repeat(offset)}${core}`).slice(offset > 0 ? 4 : 0, -4));

/** Every text that shows the word: its forms, its base64 inside a longer text, and its first eight characters. */
export const needles = (word: string): ReadonlyArray<string> => [
  ...forms(word),
  ...inside(word, Base64.encode),
  ...inside(word, Base64Url.encode),
  word.slice(0, 8),
];

/** The needles that some text holds. */
export const showsAny = (texts: ReadonlyArray<string>, found: ReadonlyArray<string>): ReadonlyArray<string> =>
  found.filter((needle) => texts.some((each) => each.includes(needle))).map((needle) => needle.slice(0, 24));

// ---- every text a codec gives for an error

/** A schema that needs no service to read or write: the kind every error class here is. */
type Plain = Schema.Top & { readonly EncodingServices: never; readonly DecodingServices: never };

/** The text of an attempt to write: the JSON it wrote, or each rendering of the refusal it met: its message, its stack, its text and a formatter's. */
const attempted = (attempt: () => Written): ReadonlyArray<string> =>
  Result.match(Result.try(attempt), {
    onSuccess: (value) => [JSON.stringify(value) ?? ""],
    onFailure: (refused) =>
      Predicate.isError(refused)
        ? [refused.message, refused.stack ?? "", String(refused), Formatter.format(refused)]
        : [String(refused)],
  });

/**
 * Every text the codecs give for `error`, written by `schema`: the JSON codec, the string-tree codec and the Go-style JSON codec, each alone, and the JSON
 * codec over an `Exit` that fails with it and an `Exit` that dies of it. An encode that throws gives its rendered refusal instead, so a refused encode is
 * read too.
 */
export const written = <S extends Plain>(schema: S, error: S["Type"]): ReadonlyArray<string> => {
  const exit = Schema.toCodecJson(Schema.Exit(Schema.Void, schema, Schema.Defect()));

  return [
    ...attempted(() => Schema.encodeUnknownSync(Schema.toCodecJson(schema))(error)),
    ...attempted(() => Schema.encodeUnknownSync(Schema.toCodecStringTree(schema))(error)),
    ...attempted(() => Schema.encodeUnknownSync(Schema.toCodecGoJson(schema))(error)),
    ...attempted(() => Schema.encodeUnknownSync(exit)(Exit.fail(error))),
    ...attempted(() => Schema.encodeUnknownSync(exit)(Exit.die(error))),
  ];
};

/**
 * What a codec writes for a value, read as a record of its own keys, as a wire holds it: a key that holds `undefined` is not a key. A value that is no
 * record fails the law that asked.
 */
export const asRecord = (value: Written | object): WireRecord =>
  Object.fromEntries(
    Object.entries(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value)).filter(
      ([, each]) => each !== undefined,
    ),
  );

/** A wire object with its tag first, as a wire holds it: for a read, and for a law that compares the keys written. */
export const taggedWire = (tag: string, fields: Readonly<Record<string, Schema.Json>>): Schema.JsonObject =>
  Object.fromEntries([["_tag", tag], ...Object.entries(fields)]);

/** One codec that writes outward: its name, and how it writes and reads a value through a schema. */
interface Codec {
  readonly name: string;
  readonly encode: <S extends Plain>(schema: S, value: S["Type"]) => Written;
  readonly decode: <S extends Plain>(schema: S, wire: WireRecord) => S["Type"];
}

/** The three codecs that write a hidden cause outward: JSON, the string tree, and the Go-style JSON. */
export const CODECS: ReadonlyArray<Codec> = [
  {
    name: "toCodecJson",
    encode: (schema, value) => Schema.encodeUnknownSync(Schema.toCodecJson(schema))(value),
    decode: (schema, wire) => Schema.decodeUnknownSync(Schema.toCodecJson(schema))(wire),
  },
  {
    name: "toCodecStringTree",
    encode: (schema, value) => Schema.encodeUnknownSync(Schema.toCodecStringTree(schema))(value),
    decode: (schema, wire) => Schema.decodeUnknownSync(Schema.toCodecStringTree(schema))(wire),
  },
  {
    name: "toCodecGoJson",
    encode: (schema, value) => Schema.encodeUnknownSync(Schema.toCodecGoJson(schema))(value),
    decode: (schema, wire) => Schema.decodeUnknownSync(Schema.toCodecGoJson(schema))(wire),
  },
];

/** What a read refused, as the standard form of a schema gives it: where each issue is, and what it says. */
interface Refusal {
  readonly paths: ReadonlyArray<ReadonlyArray<string>>;
  readonly messages: ReadonlyArray<string>;
}

const Issues = Schema.Array(
  Schema.Struct({
    message: Schema.String,
    path: Schema.optional(
      Schema.Array(Schema.Union([Schema.String, Schema.Struct({ key: Schema.Union([Schema.String, Schema.Finite]) })])),
    ),
  }),
);

/** Reads `wire` with the JSON codec of `schema`, and gives what it refused: nothing when the read took it. */
export const refusal = (schema: Plain, wire: Schema.Json): Refusal | undefined => {
  const result = Schema.toStandardSchemaV1(Schema.toCodecJson(schema))["~standard"].validate(wire);

  if (!Predicate.hasProperty(result, "issues") || result.issues === undefined) {
    return undefined;
  }

  const issues = Schema.decodeUnknownSync(Issues)(result.issues);

  return {
    paths: issues.map((issue) => (issue.path ?? []).map((step) => String(Predicate.isString(step) ? step : step.key))),
    messages: issues.map((issue) => issue.message),
  };
};

/** What `Schema.toCodecJson(Schema.Defect())` writes for a value that is not hidden: the control that a search can find the word. */
export const plainText = (value: Quoted | undefined): ReadonlyArray<string> =>
  attempted(() => Schema.encodeUnknownSync(Schema.toCodecJson(Schema.Defect()))(value));
