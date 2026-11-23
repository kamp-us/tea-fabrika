// What the laws of `@kalfa/secrets` share: the generators, the forms a value is written in elsewhere, a recording tracer and logger. Each law
// applies, to each value it draws, one made from it for every class the plan names, so every class is reached in every run and no run can
// pass on less.
import {
  Arbitrary,
  Array as Arr,
  Effect,
  Equal,
  type Exit,
  Logger,
  Match,
  Layer,
  Option,
  Predicate,
  Redacted,
  References,
  Result,
  Schema,
  Tracer,
} from "effect";
import { Base64, Base64Url, Hex } from "effect/encoding";
import * as Errors from "./Errors.ts";
import * as Recorder from "./Recorder.ts";
import * as Store from "./Store.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

// ---- the small tools the generators are built from

/** A whole number from `minimum` to `maximum`. */
export const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** One of the choices. */
export const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

const LOWER = [..."abcdefghijklmnopqrstuvwxyz"];

const ALNUM = [...LOWER, ..."0123456789"];

const ALNUM_ANY_CASE = [...ALNUM, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** What an arbitrary draws. */
type Drawn<A> = A extends Arbitrary.Arbitrary<infer B> ? B : never;

/** A value a test must not be able to hide from a search: a text a drawn value cannot hold by chance, as a user, a query or a fragment in a URL kept it. */
export const marker: Arbitrary.Arbitrary<string> = Arbitrary.array(pick(ALNUM_ANY_CASE), {
  minLength: 8,
  maxLength: 12,
}).pipe(Arbitrary.map((chars) => `qz9${chars.join("")}`));

// ---- names: the plan's classes (a) and (b), made from one drawn texture

/** One part of a name: a lowercase letter, then letters and digits. */
const part: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(LOWER),
  rest: Arbitrary.array(pick(ALNUM), { maxLength: 6 }),
}).pipe(Arbitrary.map(({ head, rest }) => `${head}${rest.join("")}`));

/** A segment of a name: parts joined by single hyphens. */
const segment: Arbitrary.Arbitrary<string> = Arbitrary.all({
  first: part,
  more: Arbitrary.array(part, { maxLength: 2 }),
}).pipe(Arbitrary.map(({ first, more }) => [first, ...more].join("-")));

/** What every name law draws once: the segments of a name, and the words a store id and a version are made from. */
export const nameTexture = Arbitrary.all({
  segments: Arbitrary.array(segment, { minLength: 1, maxLength: 4 }),
  word: segment,
  other: pick(["memory", "env", "keychain", "file", "cloudflare"]),
  label: Arbitrary.array(pick([...ALNUM, ":", "-", "_", ".", " ", "="]), { minLength: 1, maxLength: 40 }),
});

type NameTexture = Drawn<typeof nameTexture>;

/** A drawn text and the class of it: whether a check must take it. */
interface Case {
  readonly id: string;
  readonly text: string;
}

/** The name classes the plan's (a) lists, as a name's own words give them. */
export const ACCEPTED_NAME_CLASSES = ["one segment", "many segments", "digits", "256 characters"] as const;

/** The name classes the plan's (b) lists. */
export const REFUSED_NAME_CLASSES = [
  "empty",
  "uppercase",
  "a space",
  "a letter past ASCII",
  "a leading slash",
  "a trailing slash",
  "a doubled slash",
  "a doubled hyphen",
  "257 characters",
] as const;

/** The longest part of a name, between two slashes. */
export const PART_LIMIT = 64;

/** `head` with parts of `a` added, none over the part limit, until the name is `length` characters long. */
const padded = (head: string, length: number): string => {
  let name = head;

  while (name.length < length) {
    // The part that ends the name exactly, or a shorter one that leaves left for one more part of a character at least.
    const left = length - name.length - 1;
    const part = left <= PART_LIMIT ? left : Math.min(PART_LIMIT, left - 2);

    name = `${name}/${"a".repeat(part)}`;
  }

  return name;
};

/** Names a name Schema must take: one made for each class of (a). */
export const acceptedNames = (texture: NameTexture): ReadonlyArray<Case> => {
  const first = Arr.getUnsafe(texture.segments, 0);

  return [
    { id: "one segment", text: first },
    { id: "many segments", text: texture.segments.join("/") },
    { id: "digits", text: `${first}7-${texture.word}9` },
    { id: "256 characters", text: padded(texture.segments.join("/"), 256) },
  ];
};

/** Names a name Schema must refuse: one made for each class of (b). */
export const refusedNames = (texture: NameTexture): ReadonlyArray<Case> => {
  const first = Arr.getUnsafe(texture.segments, 0);
  const joined = texture.segments.join("/");

  return [
    { id: "empty", text: "" },
    { id: "uppercase", text: joined.replace(/[a-z]/u, (letter: string) => letter.toUpperCase()) },
    { id: "a space", text: `${first} ${texture.word}` },
    { id: "a letter past ASCII", text: `${joined}é` },
    { id: "a leading slash", text: `/${joined}` },
    { id: "a trailing slash", text: `${joined}/` },
    { id: "a doubled slash", text: `${first}//${texture.word}` },
    { id: "a doubled hyphen", text: `${first}--${texture.word}` },
    { id: "257 characters", text: padded(joined, 257) },
  ];
};

/** Store ids that are taken: the plan's two, another store's word, and a hyphenated word. */
export const acceptedStoreIds = (texture: NameTexture): ReadonlyArray<string> => [
  "memory",
  "env",
  texture.other,
  texture.word,
];

/** Store ids that are refused: empty, an uppercase letter, a space, a slash, a doubled hyphen, a letter past ASCII. */
export const refusedStoreIds = (texture: NameTexture): ReadonlyArray<Case> => [
  { id: "empty", text: "" },
  { id: "uppercase", text: texture.other.toUpperCase() },
  { id: "a space", text: `${texture.other} ${texture.other}` },
  { id: "a slash", text: `${texture.other}/${texture.other}` },
  { id: "a doubled hyphen", text: `${texture.other}--${texture.other}` },
  { id: "a letter past ASCII", text: `${texture.other}é` },
];

/** Versions that are taken: one character, 128 characters, and a drawn label. */
export const acceptedVersions = (texture: NameTexture): ReadonlyArray<string> => [
  "1",
  "a".repeat(128),
  texture.label.join(""),
  `sha256:${texture.word}`,
];

/** Versions that are refused: empty and 129 characters. */
export const refusedVersions: ReadonlyArray<Case> = [
  { id: "empty", text: "" },
  { id: "129 characters", text: "a".repeat(129) },
];

// ---- values: the plan's classes (c) to (f), each made from one drawn texture

/** The ids of the value classes: (c) hard characters, (d) 64 KB, (e) PEM armor around base64, (f) the empty text. */
const VALUE_CLASSES = ["c", "d", "e", "f"] as const;

type ValueClass = (typeof VALUE_CLASSES)[number];

/** Pieces a value may hold: quotes, backslashes, CR and LF, control characters, letters past ASCII and an emoji. */
const PIECES = [
  '"',
  "'",
  "\\",
  "\r",
  "\n",
  "\r\n",
  "\t",
  "\u0000",
  "\u0001",
  "\u001f",
  " ",
  "é",
  "设",
  "😀",
  " ",
  "&",
  "=",
  "%",
  "+",
  "/",
  "?",
  "#",
  "<",
] as const;

// The armor of a PEM text, written in pieces: a drawn value that looks like a key must not trip the leak check on this file.
const BEGIN = ["-----BEGIN", " PRIVATE", " KEY-----"].join("");

const END = ["-----END", " PRIVATE", " KEY-----"].join("");

/** What every value law draws once: a marker for each class, and the pieces around it. */
export const valueTexture = Arbitrary.all({
  c: marker,
  d: marker,
  e: marker,
  tailC: Arbitrary.array(pick(PIECES), { minLength: 1, maxLength: 8 }),
  tailD: Arbitrary.array(pick(PIECES), { minLength: 1, maxLength: 8 }),
});

type ValueTexture = Drawn<typeof valueTexture>;

/** A value a person put in a store, the marker that makes it findable, and the class it is of. */
export interface Value {
  readonly id: ValueClass;
  readonly text: string;
  readonly core: string;
}

/** The values of every class (c) to (f), each made from the texture. Each starts with its marker, so a cut-off copy still holds some of it. */
export const valueClasses = (texture: ValueTexture): ReadonlyArray<Value> => {
  // Whole units, then padding, so no letter past ASCII is cut in half: a text cut inside a surrogate pair is no text a person could put.
  const unit = `${texture.d}${texture.tailD.join("")}`;
  // The PEM body: a base64 line that holds the marker whole, then one more line.
  const line = `${texture.e}${"A".repeat(64)}`.slice(0, 64);

  return [
    { id: "c", text: `${texture.c}${texture.tailC.join("")}`, core: texture.c },
    { id: "d", text: unit.repeat(Math.floor(65536 / unit.length)).padEnd(65536, "a"), core: texture.d },
    {
      id: "e",
      text: `${BEGIN}\n${line}\n${"B".repeat(64)}\n${END}\n`,
      core: texture.e,
    },
    { id: "f", text: "", core: "" },
  ];
};

/** The values a search can find: every class but the empty text. */
export const findable = (values: ReadonlyArray<Value>): ReadonlyArray<Value> =>
  values.filter((value) => value.text !== "");

/** The forms a text is written in elsewhere: as it is, as JSON text holds it, in base64, in base64url, in hex, and percent-encoded. */
const forms = (text: string): ReadonlyArray<string> => [
  text,
  JSON.stringify(text).slice(1, -1),
  Base64.encode(text),
  Base64Url.encode(text),
  Hex.encode(text),
  encodeURIComponent(text),
];

/**
 * The base64 text a marker makes inside a longer text, at each of the three alignments a base64 writer meets it: the first and last groups are cut
 * off, since they mix the marker with what is around it, and what stays is the same wherever the marker sits.
 */
const inside = (core: string, encode: (input: string) => string): ReadonlyArray<string> =>
  [0, 1, 2].map((offset) => encode(`${"A".repeat(offset)}${core}`).slice(offset > 0 ? 4 : 0, -4));

/** Every text that shows a value: its forms, its marker's forms, the marker's base64 inside a longer text, and the first eight characters of the marker. */
export const needles = (value: Value): ReadonlyArray<string> =>
  [
    ...forms(value.text),
    ...forms(value.core),
    ...inside(value.core, Base64.encode),
    ...inside(value.core, Base64Url.encode),
    value.core.slice(0, 8),
  ].filter((each) => each !== "");

/** The needles that some text holds. */
export const showsAny = (texts: ReadonlyArray<string>, found: ReadonlyArray<string>): ReadonlyArray<string> =>
  found.filter((needle) => texts.some((each) => each.includes(needle))).map((needle) => needle.slice(0, 24));

/** Every text a value's own properties reach, names and symbols' descriptions included, cause chains and nested objects too. */
export const reachable = (root: object): ReadonlyArray<string> => {
  const seen = new Set<object>();
  const found: Array<string> = [];
  const pending: Array<object> = [root];

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined || seen.has(next)) {
      continue;
    }

    seen.add(next);

    for (const key of Reflect.ownKeys(next)) {
      found.push(String(key));

      const value = Object.getOwnPropertyDescriptor(next, key)?.value;

      if (Predicate.isString(value)) {
        found.push(value);
      } else if (Predicate.isObjectOrArray(value)) {
        pending.push(value);
      }
    }
  }

  return found;
};

/** The text a span holds: its name, its attributes, its events and how it ended. */
export const spanText = (span: Tracer.Span): string =>
  [
    span.name,
    ...[...span.attributes].map(
      ([key, value]) => `${key}=${Predicate.isString(value) ? value : JSON.stringify(value)}`,
    ),
    JSON.stringify(Predicate.hasProperty(span, "events") ? span.events : [], (_, each) =>
      Predicate.isBigInt(each) ? String(each) : each,
    ),
    JSON.stringify(span.status, (_, each) => (Predicate.isBigInt(each) ? String(each) : each)),
  ].join("\n");

// ---- watching a program: every span it makes and every log line at any level

/** What one run of a program did: how it ended, every span it made, and every log line at every level, as structured JSON text. */
interface Watched<A, E> {
  readonly exit: Exit.Exit<A, E>;
  readonly spans: ReadonlyArray<Tracer.Span>;
  readonly logs: ReadonlyArray<string>;
}

/** Runs `program` under a tracer that keeps every span and a logger that keeps every line, at every log level. */
export const watched = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<Watched<A, E>, never, R> =>
  Effect.gen(function* () {
    const delegate = yield* Tracer.Tracer;
    const spans: Array<Tracer.Span> = [];
    const logs: Array<string> = [];

    const tracer = Tracer.make({
      span(options) {
        const span = delegate.span(options);
        spans.push(span);

        return span;
      },
    });

    const logger = Logger.map(Logger.formatStructured, (entry) => {
      logs.push(JSON.stringify(entry));
    });

    const exit = yield* program.pipe(
      Effect.withTracer(tracer),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "All"),
      Effect.exit,
    );

    return { exit, spans, logs };
  });

// ---- a store's port and its answers

/** The store's `holds` port, or a plain failure: the laws that ask for it are for a store that holds values. */
export const holder = <Item, R>(store: Store.Store<string, Item, R>): Store.Holds<Item, R> => {
  if (store.holds === undefined) {
    throw new Error(`the ${store.id} store has no holds port`);
  }

  return store.holds;
};

/** What a store's answer says in a few words: `found`, or `missing` and why. */
export const outcome = (held: Store.Held): string =>
  Match.value(held).pipe(
    Match.tag("Found", () => "found"),
    Match.tag("Missing", (missing) => `missing ${missing.reason}`),
    Match.exhaustive,
  );

/** The hidden value and the version of a Found answer, and nothing for a Missing one. */
export const found = (
  held: Store.Held,
): Option.Option<{ readonly value: Redacted.Redacted<string>; readonly version: string }> =>
  Predicate.isTagged(held, "Found") ? Option.some(held.value) : Option.none();

/** Whether a hidden value holds `text`, compared as `Redacted` compares: without turning the value into text. */
const holds = (hidden: Redacted.Redacted<string>, text: string): boolean => Equal.equals(hidden, Redacted.make(text));

/** What an answer shows of a value put in: whether it is hidden, whether it is exactly `text`, and its version; nothing for a Missing. */
export const reading = (held: Store.Held, text: string) =>
  Option.getOrUndefined(
    Option.map(found(held), (each) => ({
      hidden: Redacted.isRedacted(each.value),
      exact: holds(each.value, text),
      version: each.version,
    })),
  );

/** The text a writer gives, or nothing when it throws: a display that cannot be written shows nothing. */
export const shown = (write: () => string | undefined): string => Result.getOrElse(Result.try(write), () => "") ?? "";

// ---- stores and a recorder that fail with a value in their error

/** The error a store's own client raises when it quotes what it read: the value in its message, and in the error under it, and under that. */
const quoting = (text: string): Error =>
  new Error(`bad value ${text}`, { cause: new Error(`nested ${text}`, { cause: text }) });

/** A store whose every read fails as `StoreFailed`, with an error that quotes `text`, a value the store holds. */
export const failingStore = (text: string) =>
  Store.make({
    id: "failing",
    item: Schema.NonEmptyString,
    place: "store",
    holds: { read: (_item: string) => Effect.fail(new Errors.StoreFailed({ cause: quoting(text) })) },
  });

/** A recorder whose every write fails as `RecordFailed`, with an error that quotes `text`, a value the caller held. */
export const failingRecorder = (text: string): Layer.Layer<Recorder.Recorder> =>
  Layer.succeed(Recorder.Recorder, { record: () => Effect.fail(new Errors.RecordFailed({ cause: quoting(text) })) });
