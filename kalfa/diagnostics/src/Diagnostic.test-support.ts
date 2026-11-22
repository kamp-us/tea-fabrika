// What the laws of this package's three modules share: generators for good and broken codes, places and
// texts. Each law applies every break and every kind of odd good value to each value it draws, so each case a
// law must reach is in every run, and no run can pass on less.
import { Arbitrary, Array as Arr, Effect, Schema, Tracer } from "effect";
import * as Diagnostic from "./Diagnostic.ts";
import * as Diagnostics from "./Diagnostics.ts";
import * as TestDiagnostics from "./TestDiagnostics.ts";

/** The shared seed: a fixed seed makes a red run repeat. */
export const SEED = 119120;

/** A break: a name, and what it makes of good parts. */
export interface Break<Parts, Made> {
  readonly name: string;
  readonly apply: (parts: Parts) => Made;
}

// ---- the small tools the generators are built from

const pattern = (form: RegExp): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(Schema.String.check(Schema.isPattern(form)));

/** A whole number from `minimum` to `maximum`. */
export const between = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

/** One of the choices. */
const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

// ---- codes

/** The parts of a good code: a root of lowercase words joined by hyphens, and a name of the same. */
interface CodeParts {
  readonly root: string;
  readonly name: string;
}

/** Parts that make a good code. */
export const codeParts: Arbitrary.Arbitrary<CodeParts> = Arbitrary.all({
  root: pattern(/^[a-z][a-z0-9]{0,4}(?:-[a-z0-9]{1,4}){0,2}$/),
  name: pattern(/^[a-z0-9]{1,4}(?:-[a-z0-9]{1,4}){0,2}$/),
});

/** The good code these parts make. */
export const toCode = ({ root, name }: CodeParts): string => `${root}/${name}`;

/** Every way to break a good code that the code's form refuses. */
export const CODE_BREAKS: ReadonlyArray<Break<CodeParts, string>> = [
  { name: "no slash", apply: ({ root, name }) => `${root}-${name}` },
  { name: "a second slash", apply: ({ root, name }) => `${root}/${name}/${name}` },
  { name: "an empty root", apply: ({ name }) => `/${name}` },
  { name: "an empty name", apply: ({ root }) => `${root}/` },
  { name: "an uppercase letter", apply: ({ root, name }) => `${root.toUpperCase()}/${name}` },
  { name: "a space", apply: ({ root, name }) => `${root} /${name}` },
  { name: "a leading hyphen on the root", apply: ({ root, name }) => `-${root}/${name}` },
  { name: "a leading hyphen on the name", apply: ({ root, name }) => `${root}/-${name}` },
  { name: "a trailing hyphen on the root", apply: ({ root, name }) => `${root}-/${name}` },
  { name: "a trailing hyphen on the name", apply: ({ root, name }) => `${root}/${name}-` },
  { name: "a double hyphen in the root", apply: ({ root, name }) => `${root}--a/${name}` },
  { name: "a double hyphen in the name", apply: ({ root, name }) => `${root}/${name}--a` },
  { name: "a root that starts with a digit", apply: ({ root, name }) => `7${root}/${name}` },
];

/** A code the form accepts. */
export const goodCode: Arbitrary.Arbitrary<string> = codeParts.pipe(Arbitrary.map(toCode));

// ---- places

// The four kinds of good place, as a caller writes them. Schema writes each tag, as it does for the package's own
// Place. The counts are plain numbers here, so a law can also write a bad one with `write`.
const Repo = Schema.TaggedStruct("repo", {
  path: Schema.String,
  line: Schema.optionalKey(Schema.Finite),
  column: Schema.optionalKey(Schema.Finite),
});

const Home = Schema.TaggedStruct("home", {
  path: Schema.String,
  line: Schema.optionalKey(Schema.Finite),
  column: Schema.optionalKey(Schema.Finite),
});

const Environment = Schema.TaggedStruct("environment", { name: Schema.String });

const Flag = Schema.TaggedStruct("flag", { name: Schema.String });

/** A good place of any of the four kinds, as a caller writes it. */
type PlaceInput = typeof Repo.Type | typeof Home.Type | typeof Environment.Type | typeof Flag.Type;

// A place of any shape a caller might write, good or not: any tag, with any of the four fields.
const Written = (tag: string) =>
  Schema.TaggedStruct(tag, {
    path: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
    line: Schema.optionalKey(Schema.Finite),
    column: Schema.optionalKey(Schema.Finite),
  });

const writers = new Map<string, ReturnType<typeof Written>>();

/** The fields a bad place may hold. */
interface Fields {
  readonly path?: string;
  readonly name?: string;
  readonly line?: number;
  readonly column?: number;
}

// A place with a tag and fields as given, whatever they are. Each tag has its own Schema, made once.
const write = (tag: string, fields: Fields): object => {
  const known = writers.get(tag) ?? Written(tag);
  writers.set(tag, known);

  return known.make(fields);
};

/** A named thing a law checks: the name says which class of input it is. */
interface Case<Value> {
  readonly name: string;
  readonly value: Value;
}

/** A good place and the text a person reads for it, written apart from the code that makes it. */
interface Shown<Value> extends Case<Value> {
  readonly text: string;
}

/**
 * The drawn parts every kind of place is made from. Each kind reads the parts it needs and ignores the rest.
 *
 * `segments`, `line`, `column` and `at` make a path; `name` is a drawn name a shell can expand and an environment
 * variable is called by; `flag` is the body of a flag's name; `login` is a login name, which always holds a digit
 * so that no fixed text of an error message can hold it by chance.
 */
interface PlaceParts {
  readonly segments: ReadonlyArray<string>;
  readonly line: number;
  readonly column: number;
  readonly at: number;
  readonly name: string;
  readonly flag: string;
  readonly login: string;
}

// A drawn segment is plain: it never starts with a dot, a tilde or a dollar sign, so it is never "." or "..", and it
// is never a start that reads as the home folder. The odd good segments are made from it by SEGMENT_KINDS and
// SIGIL_KINDS.
const segment = pattern(/^[a-zA-Z0-9_@+()-][a-zA-Z0-9_~@+().-]{0,5}$/);

/** Parts that make good places and broken ones, of all four kinds. */
export const placeParts: Arbitrary.Arbitrary<PlaceParts> = Arbitrary.all({
  segments: Arbitrary.array(segment, { minLength: 1, maxLength: 4 }),
  line: between(1, 100000),
  column: between(1, 500),
  at: between(0, 4),
  name: pattern(/^[a-zA-Z][a-zA-Z0-9_]{0,8}$/),
  flag: pattern(/^[a-zA-Z0-9]{1,8}$/),
  login: pattern(/^[a-z][a-z0-9._-]{0,5}[0-9][a-z0-9]{0,5}$/),
});

/** A kind of odd but good path segment: what it makes of a plain segment. */
const SEGMENT_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "starts with a dot", apply: (part) => `.${part}` },
  { name: "starts with two dots", apply: (part) => `..${part}` },
  { name: "only three dots", apply: () => "..." },
  { name: "a space at the start", apply: (part) => ` ${part}` },
  { name: "a space inside", apply: (part) => `${part} ${part}` },
  { name: "a space at the end", apply: (part) => `${part} ` },
  { name: "ASCII punctuation", apply: (part) => `${part}#%,=[]{}!$&';:` },
  { name: "a letter past ASCII", apply: (part) => `${part}é` },
  { name: "a character past U+024F", apply: (part) => `${part}设` },
  { name: "a character outside the Basic Multilingual Plane", apply: (part) => `${part}\u{1F600}` },
  { name: "more than 200 characters", apply: (part) => part.padEnd(201, "x") },
];

/** A part that starts like a home folder or a variable. It is a good part anywhere but first in a repo path. */
const SIGIL_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "a part that is ~", apply: () => "~" },
  { name: "a part that starts with ~", apply: (part) => `~${part}` },
  { name: "a part that is $", apply: () => "$" },
  { name: "a part that is $HOME", apply: () => "$HOME" },
  { name: "a part that starts with $", apply: (part) => `$${part}` },
];

/** A name a shell can expand, in each class: what it makes of a plain name. */
const NAME_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "capitals, digits and underscores", apply: (name) => `${name.toUpperCase()}_2` },
  { name: "starts with an underscore", apply: (name) => `_${name}` },
  { name: "only lowercase", apply: (name) => `${name.toLowerCase()}_x` },
  { name: "only capitals", apply: (name) => name.toUpperCase() },
  { name: "one letter", apply: (name) => name.slice(0, 1) },
  { name: "one underscore", apply: () => "_" },
  { name: "more than 200 characters", apply: (name) => name.padEnd(201, "x") },
];

/** A flag as written, in each class: what it makes of a plain body. */
const FLAG_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "two hyphens and a name", apply: (body) => `--${body}` },
  { name: "a dot inside", apply: (body) => `--${body}.${body}` },
  { name: "a hyphen inside", apply: (body) => `--${body}-${body}` },
  { name: "an underscore inside", apply: (body) => `--${body}_${body}` },
  { name: "a digit first", apply: (body) => `--2${body}` },
  { name: "capitals", apply: (body) => `--${body.toUpperCase()}` },
  { name: "one hyphen and one character", apply: (body) => `-${body.slice(0, 1)}` },
  { name: "one hyphen and a digit", apply: () => "-1" },
  { name: "a name past U+024F", apply: (body) => `--设置${body}` },
  { name: "a name outside the Basic Multilingual Plane", apply: (body) => `--\u{1F600}${body}` },
  { name: "more than 200 characters", apply: (body) => `--${body.padEnd(201, "x")}` },
];

const join = (segments: ReadonlyArray<string>): string => segments.join("/");

const firstPart = (segments: ReadonlyArray<string>): string => segments[0] ?? "x";

// A path made of the segments with one more put in, where the drawn `at` says.
const through = ({ segments, at }: PlaceParts, item: string): ReadonlyArray<string> =>
  segments.toSpliced(at % (segments.length + 1), 0, item);

/** The parts of a path as drawn, and made into each class of odd good parts. */
const placeVariants = (parts: PlaceParts): ReadonlyArray<Case<PlaceParts>> => {
  const first = firstPart(parts.segments);

  return [
    { name: "as drawn", value: parts },
    ...SEGMENT_KINDS.map((kind) => ({
      name: `every part ${kind.name}`,
      value: { ...parts, segments: parts.segments.map(kind.apply) },
    })),
    // The first part stays plain: a repo path may not start with `~` or `$`. A later part may.
    ...SIGIL_KINDS.flatMap((kind) => [
      {
        name: `after the first part, ${kind.name}`,
        value: { ...parts, segments: [first, kind.apply(first), ...parts.segments.slice(1)] },
      },
      { name: `last, ${kind.name}`, value: { ...parts, segments: [...parts.segments, kind.apply(first)] } },
    ]),
  ];
};

/** The parts of a path under the home folder: the drawn parts, and the start the path begins with. */
interface HomeParts extends PlaceParts {
  readonly start: string;
}

/** The home paths' starts and parts, in each class: `~` and `$NAME` with each class of name, and each class of part. */
const homeVariants = (parts: PlaceParts): ReadonlyArray<Case<HomeParts>> => {
  const first = firstPart(parts.segments);

  const starts = [
    { name: "a ~ start", start: "~" },
    { name: "a $NAME start as drawn", start: `$${parts.name}` },
    ...NAME_KINDS.map((kind) => ({ name: `a $NAME start that is ${kind.name}`, start: `$${kind.apply(parts.name)}` })),
  ];

  const plain = starts.map(({ name, start }) => ({ name, value: { ...parts, start } }));

  // Each class of odd part, under a start taken in turn, so every class meets more than one start.
  const odd = [
    ...placeVariants(parts).slice(1),
    ...SIGIL_KINDS.map((kind) => ({
      name: `first after the start, ${kind.name}`,
      value: { ...parts, segments: [kind.apply(first), ...parts.segments.slice(1)] },
    })),
  ].map(({ name, value }, index) => ({
    name,
    value: { ...value, start: Arr.getUnsafe(starts, index % starts.length).start },
  }));

  return [...plain, ...odd];
};

const homePath = ({ start, segments }: HomeParts): string => [start, ...segments].join("/");

// The places a path makes: with no line, a line, and a line and a column, each with the text a person reads.
const repoShapes = (path: string, { line, column }: PlaceParts): ReadonlyArray<Shown<typeof Repo.Type>> => [
  { name: "no line", value: Repo.make({ path }), text: path },
  { name: "a line", value: Repo.make({ path, line }), text: `${path}:${line}` },
  { name: "a line and a column", value: Repo.make({ path, line, column }), text: `${path}:${line}:${column}` },
];

const homeShapes = (path: string, { line, column }: PlaceParts): ReadonlyArray<Shown<typeof Home.Type>> => [
  { name: "no line", value: Home.make({ path }), text: path },
  { name: "a line", value: Home.make({ path, line }), text: `${path}:${line}` },
  { name: "a line and a column", value: Home.make({ path, line, column }), text: `${path}:${line}:${column}` },
];

/** Every good file in the repo these parts make: the whole repo, and each class of path with each shape. */
export const repoPlaces = (parts: PlaceParts): ReadonlyArray<Shown<typeof Repo.Type>> => [
  { name: "the whole repo", value: Repo.make({ path: "." }), text: "." },
  ...placeVariants(parts).flatMap(({ name, value }) =>
    repoShapes(join(value.segments), value).map((shape) => ({ ...shape, name: `${name}, ${shape.name}` })),
  ),
];

/** Every good file under the home folder these parts make, each class of start and part with each shape. */
export const homePlaces = (parts: PlaceParts): ReadonlyArray<Shown<typeof Home.Type>> =>
  homeVariants(parts).flatMap(({ name, value }) =>
    homeShapes(homePath(value), value).map((shape) => ({ ...shape, name: `${name}, ${shape.name}` })),
  );

/** Every good environment variable these parts make, each class of name. */
export const environmentPlaces = (parts: PlaceParts): ReadonlyArray<Shown<typeof Environment.Type>> => [
  {
    name: "a name as drawn",
    value: Environment.make({ name: parts.name }),
    text: `environment variable ${parts.name}`,
  },
  ...NAME_KINDS.map((kind) => {
    const name = kind.apply(parts.name);

    return {
      name: `a name that is ${kind.name}`,
      value: Environment.make({ name }),
      text: `environment variable ${name}`,
    };
  }),
];

/** Every good flag these parts make, each class of name. */
export const flagPlaces = (parts: PlaceParts): ReadonlyArray<Shown<typeof Flag.Type>> =>
  FLAG_KINDS.map((kind) => {
    const name = kind.apply(parts.flag);

    return { name: `a flag that is ${kind.name}`, value: Flag.make({ name }), text: `flag ${name}` };
  });

/** Every good place these parts make, of every kind and class. */
export const goodPlaces = (parts: PlaceParts): ReadonlyArray<Shown<PlaceInput>> => [
  ...repoPlaces(parts),
  ...homePlaces(parts),
  ...environmentPlaces(parts),
  ...flagPlaces(parts),
];

// One good place of each class of each kind, the fullest shape of a file: its line and its column.
const classPlaces = (parts: PlaceParts): ReadonlyArray<PlaceInput> => [
  Repo.make({ path: "." }),
  ...placeVariants(parts).map(({ value }) =>
    Repo.make({ path: join(value.segments), line: parts.line, column: parts.column }),
  ),
  ...homeVariants(parts).map(({ value }) =>
    Home.make({ path: homePath(value), line: parts.line, column: parts.column }),
  ),
  ...environmentPlaces(parts).map(({ value }) => value),
  ...flagPlaces(parts).map(({ value }) => value),
];

// ---- breaks of a place

/** What the break of a count (a line or a column) needs: the kind, a good path and the drawn counts. */
interface Counted {
  readonly tag: "repo" | "home";
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

const COUNT_BREAKS: ReadonlyArray<Break<Counted, object>> = [
  { name: "a line of 0", apply: ({ tag, path }) => write(tag, { path, line: 0 }) },
  { name: "a negative line", apply: ({ tag, path, line }) => write(tag, { path, line: -line }) },
  { name: "a fractional line", apply: ({ tag, path, line }) => write(tag, { path, line: line + 0.5 }) },
  { name: "a column of 0", apply: ({ tag, path, line }) => write(tag, { path, line, column: 0 }) },
  { name: "a negative column", apply: ({ tag, path, line, column }) => write(tag, { path, line, column: -column }) },
  {
    name: "a fractional column",
    apply: ({ tag, path, line, column }) => write(tag, { path, line, column: column + 0.5 }),
  },
  { name: "a column with no line", apply: ({ tag, path, column }) => write(tag, { path, column }) },
];

const repo = (path: string): object => write("repo", { path });

const REPO_BREAKS: ReadonlyArray<Break<PlaceParts, object>> = [
  { name: "an empty path", apply: () => repo("") },
  { name: "a leading slash", apply: ({ segments }) => repo(`/${join(segments)}`) },
  { name: "a ./ start", apply: ({ segments }) => repo(`./${join(segments)}`) },
  { name: "a .. segment", apply: (parts) => repo(join(through(parts, ".."))) },
  { name: "a . segment", apply: (parts) => repo(join(through(parts, "."))) },
  { name: "an empty segment", apply: (parts) => repo(join(through(parts, ""))) },
  { name: "a trailing slash", apply: ({ segments }) => repo(`${join(segments)}/`) },
  { name: "a backslash", apply: ({ segments }) => repo(`${join(segments)}\\x`) },
  { name: "a line on the whole repo", apply: ({ line }) => write("repo", { path: ".", line }) },
  { name: "a first part that is ~", apply: ({ segments }) => repo(`~/${join(segments)}`) },
  { name: "a first part that is ~ and a login", apply: ({ segments }) => repo(`~${join(segments)}`) },
  { name: "a first part that is $", apply: ({ segments }) => repo(`$/${join(segments)}`) },
  { name: "a first part that is $ and a name", apply: ({ segments, name }) => repo(`$${name}/${join(segments)}`) },
  { name: "a first part that is $ and a digit", apply: ({ segments }) => repo(`$1/${join(segments)}`) },
  ...COUNT_BREAKS.map((count) => ({
    name: count.name,
    apply: ({ segments, line, column }: PlaceParts) => count.apply({ tag: "repo", path: join(segments), line, column }),
  })),
];

// The braces of `${NAME}`, built apart so no template here reads as one.
const braced = (name: string): string => ["$", "{", name, "}"].join("");

const home = (path: string): object => write("home", { path });

const HOME_BREAKS: ReadonlyArray<Break<HomeParts, object>> = [
  { name: "~ alone", apply: () => home("~") },
  { name: "~/ alone", apply: () => home("~/") },
  { name: "$NAME alone", apply: ({ name }) => home(`$${name}`) },
  { name: "$NAME/ alone", apply: ({ name }) => home(`$${name}/`) },
  { name: "a dot", apply: () => home(".") },
  { name: "an absolute path", apply: ({ segments }) => home(`/${join(segments)}`) },
  { name: "~ and a login", apply: ({ segments }) => home(`~${join(segments)}`) },
  { name: "a name in braces", apply: ({ name, segments }) => home(`${braced(name)}/${join(segments)}`) },
  { name: "$ and no name", apply: ({ segments }) => home(`$/${join(segments)}`) },
  {
    name: "$ and a name that starts with a digit",
    apply: ({ name, segments }) => home(`$1${name}/${join(segments)}`),
  },
  { name: "a name with a hyphen", apply: ({ name, segments }) => home(`$${name}-${name}/${join(segments)}`) },
  { name: "a name with a dot", apply: ({ name, segments }) => home(`$${name}.${name}/${join(segments)}`) },
  { name: "a name with a space", apply: ({ name, segments }) => home(`$${name} ${name}/${join(segments)}`) },
  { name: "a name with a letter past ASCII", apply: ({ name, segments }) => home(`$${name}é/${join(segments)}`) },
  {
    name: "a name with a character past U+024F",
    apply: ({ name, segments }) => home(`$${name}设/${join(segments)}`),
  },
  { name: "an empty part after the start", apply: (parts) => home([parts.start, ...through(parts, "")].join("/")) },
  { name: "a . part after the start", apply: (parts) => home([parts.start, ...through(parts, ".")].join("/")) },
  { name: "a .. part after the start", apply: (parts) => home([parts.start, ...through(parts, "..")].join("/")) },
  { name: "a trailing slash", apply: (parts) => home(`${homePath(parts)}/`) },
  { name: "a backslash", apply: (parts) => home(`${homePath(parts)}\\x`) },
  { name: "a drive", apply: ({ segments }) => home(`C:/${join(segments)}`) },
  ...COUNT_BREAKS.map((count) => ({
    name: count.name,
    apply: (parts: HomeParts) =>
      count.apply({ tag: "home", path: homePath(parts), line: parts.line, column: parts.column }),
  })),
];

// What a place with no line or column may not be given: a line, a column, or both.
const noCounts = (
  tag: "environment" | "flag",
  name: (parts: PlaceParts) => string,
): ReadonlyArray<Break<PlaceParts, object>> => [
  { name: `${tag} with a line`, apply: (parts) => write(tag, { name: name(parts), line: parts.line }) },
  { name: `${tag} with a column`, apply: (parts) => write(tag, { name: name(parts), column: parts.column }) },
  {
    name: `${tag} with a line and a column`,
    apply: (parts) => write(tag, { name: name(parts), line: parts.line, column: parts.column }),
  },
];

const variable = (name: string): object => write("environment", { name });

const ENVIRONMENT_BREAKS: ReadonlyArray<Break<PlaceParts, object>> = [
  { name: "an empty name", apply: () => variable("") },
  { name: "a name that starts with a digit", apply: ({ name }) => variable(`1${name}`) },
  { name: "a name with a hyphen", apply: ({ name }) => variable(`${name}-${name}`) },
  { name: "a name with a dot", apply: ({ name }) => variable(`${name}.${name}`) },
  { name: "a name with a space", apply: ({ name }) => variable(`${name} ${name}`) },
  { name: "a name with =", apply: ({ name }) => variable(`${name}=${name}`) },
  { name: "a name with $", apply: ({ name }) => variable(`${name}$${name}`) },
  { name: "a name with /", apply: ({ name }) => variable(`${name}/${name}`) },
  { name: "a name with a letter past ASCII", apply: ({ name }) => variable(`${name}é`) },
  { name: "a name with a character past U+024F", apply: ({ name }) => variable(`${name}设`) },
  { name: "a $ in front", apply: ({ name }) => variable(`$${name}`) },
  ...noCounts("environment", ({ name }) => name),
];

// Whitespace and control characters a flag may not hold, one of each kind.
const FLAG_REFUSED: ReadonlyArray<Case<string>> = [
  { name: "a space", value: " " },
  { name: "a tab", value: "\t" },
  { name: "a line break", value: "\n" },
  { name: "a no-break space", value: "\u00A0" },
  { name: "an ideographic space", value: "\u3000" },
  { name: "ESC", value: "\u001B" },
  { name: "DEL", value: "\u007F" },
  { name: "a C1 control character", value: "\u0085" },
];

const flag = (name: string): object => write("flag", { name });

const FLAG_BREAKS: ReadonlyArray<Break<PlaceParts, object>> = [
  { name: "an empty name", apply: () => flag("") },
  { name: "one hyphen alone", apply: () => flag("-") },
  { name: "two hyphens alone", apply: () => flag("--") },
  { name: "three hyphens and a name", apply: (parts) => flag(`---${parts.flag}`) },
  { name: "no leading hyphen", apply: (parts) => flag(parts.flag) },
  { name: "a value after =", apply: (parts) => flag(`--${parts.flag}=${parts.flag}`) },
  ...FLAG_REFUSED.flatMap((refused) => [
    {
      name: `${refused.name} inside`,
      apply: (parts: PlaceParts) => flag(`--${parts.flag}${refused.value}${parts.flag}`),
    },
    { name: `${refused.name} at the end`, apply: (parts: PlaceParts) => flag(`--${parts.flag}${refused.value}`) },
  ]),
  ...noCounts("flag", (parts) => `--${parts.flag}`),
];

/** What makes a place no place of any kind: an old shape, an unknown or missing tag, and another kind's fields. */
const SHAPE_BREAKS: ReadonlyArray<Break<PlaceParts, object>> = [
  { name: "the old shape, a path", apply: ({ segments }) => ({ path: join(segments) }) },
  { name: "the old shape, a path and a line", apply: ({ segments, line }) => ({ path: join(segments), line }) },
  { name: "the old shape, the whole repo", apply: () => ({ path: "." }) },
  { name: "a name and no tag", apply: ({ name }) => ({ name }) },
  { name: "nothing", apply: () => ({}) },
  { name: "an unknown tag", apply: ({ segments }) => write("file", { path: join(segments) }) },
  { name: "a tag with another case", apply: ({ segments }) => write("Repo", { path: join(segments) }) },
  { name: "an empty tag", apply: ({ segments }) => write("", { path: join(segments) }) },
  { name: "an environment tag with a path", apply: ({ segments }) => write("environment", { path: join(segments) }) },
  { name: "a flag tag with a path", apply: ({ segments }) => write("flag", { path: join(segments) }) },
  { name: "a home tag with a name", apply: ({ name }) => write("home", { name }) },
  { name: "a repo tag with a name", apply: ({ name }) => write("repo", { name }) },
];

const named = (breaks: ReadonlyArray<Break<PlaceParts, object>>, parts: PlaceParts): ReadonlyArray<Case<object>> =>
  breaks.map((broken) => ({ name: broken.name, value: broken.apply(parts) }));

/** Every way to break a file in the repo, made from each class of odd good parts. */
export const repoBreaks = (parts: PlaceParts): ReadonlyArray<Case<object>> =>
  placeVariants(parts).flatMap((variant) =>
    named(REPO_BREAKS, variant.value).map((each) => ({ name: `${each.name}, ${variant.name}`, value: each.value })),
  );

/** Every way to break a file under the home folder, made from each class of start and odd good parts. */
export const homeBreaks = (parts: PlaceParts): ReadonlyArray<Case<object>> =>
  homeVariants(parts).flatMap((variant) =>
    HOME_BREAKS.map((broken) => ({ name: `${broken.name}, ${variant.name}`, value: broken.apply(variant.value) })),
  );

/** Every way to break an environment variable. */
export const environmentBreaks = (parts: PlaceParts): ReadonlyArray<Case<object>> => named(ENVIRONMENT_BREAKS, parts);

/** Every way to break a flag. */
export const flagBreaks = (parts: PlaceParts): ReadonlyArray<Case<object>> => named(FLAG_BREAKS, parts);

/** Every way to give a value that is no place of any kind. */
export const shapeBreaks = (parts: PlaceParts): ReadonlyArray<Case<object>> => named(SHAPE_BREAKS, parts);

// ---- logins and the roots a machine puts them in

/** A login name in each class: plain, with each of `.`, `_` and `-`, and more than 32 characters. */
const LOGIN_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "a plain login", apply: (login) => login },
  { name: "a login with a dot", apply: (login) => `${login}.${login}` },
  { name: "a login with an underscore", apply: (login) => `${login}_${login}` },
  { name: "a login with a hyphen", apply: (login) => `${login}-${login}` },
  { name: "a login of more than 32 characters", apply: (login) => login.padEnd(33, "x") },
];

// Each root a machine puts a login in, built from pieces joined at run time: no file holds a whole machine path.
// `drive` marks the Windows drive with forward slashes: its first part is `C:`, so a repo path may start with it.
const ROOTS: ReadonlyArray<{
  readonly name: string;
  readonly drive: boolean;
  readonly at: (login: string) => string;
}> = [
  { name: "the macOS root", drive: false, at: (login) => ["", "Users", login].join("/") },
  { name: "the Linux root", drive: false, at: (login) => ["", "home", login].join("/") },
  { name: "the Linux root under var", drive: false, at: (login) => ["", "var", "home", login].join("/") },
  { name: "a Windows drive with forward slashes", drive: true, at: (login) => ["C:", "Users", login].join("/") },
  { name: "a Windows drive with backslashes", drive: false, at: (login) => ["C:", "Users", login].join("\\") },
  { name: "a network share", drive: false, at: (login) => ["", "", "server", login].join("\\") },
  { name: "a ~ and a login", drive: false, at: (login) => `~${login}` },
];

/**
 * Each class of login in each root a machine uses, each followed by a file name, put as a home file and as a repo
 * file. Both must be refused, except that a Windows drive with forward slashes is a legal relative repo path, `C:`
 * being a part (the plan's gap): that one is put as a home file only.
 */
export const rootedAtLogin = ({
  login,
}: PlaceParts): ReadonlyArray<{
  readonly name: string;
  readonly login: string;
  readonly places: ReadonlyArray<Case<object>>;
}> =>
  LOGIN_KINDS.flatMap((kind) =>
    ROOTS.map((root) => {
      const name = kind.apply(login);
      const path = `${root.at(name)}/.demo/demo.toml`;

      return {
        name: `${kind.name} in ${root.name}`,
        login: name,
        places: [
          { name: "as a home file", value: home(path) },
          ...(root.drive ? [] : [{ name: "as a repo file", value: repo(path) }]),
        ],
      };
    }),
  );

/** Every break of every kind of place, made from the drawn parts as they are, and each login's path in each root. */
export const brokenPlaces = (parts: PlaceParts): ReadonlyArray<Case<object>> => [
  ...named(REPO_BREAKS, parts),
  ...HOME_BREAKS.map((broken) => ({ name: broken.name, value: broken.apply({ ...parts, start: "~" }) })),
  ...environmentBreaks(parts),
  ...flagBreaks(parts),
  ...shapeBreaks(parts),
  ...rootedAtLogin(parts).flatMap((rooted) =>
    rooted.places.map((place) => ({ name: `${rooted.name}, ${place.name}`, value: place.value })),
  ),
];

// ---- texts

/** Some text that is not only whitespace: it starts with a visible character, and may hold spaces after. */
const nonBlank: Arbitrary.Arbitrary<string> = pattern(/^[!-~¡-ɏ][ -~¡-ɏ]{0,15}$/);

/** A kind of odd but good text: what it makes of some plain good text. */
export const TEXT_KINDS: ReadonlyArray<Break<string, string>> = [
  { name: "a space before the first visible character", apply: (text) => ` ${text}` },
  { name: "a tab before the first visible character", apply: (text) => `\t${text}` },
  { name: "a line break before the first visible character", apply: (text) => `\n${text}` },
  { name: "a no-break space before the first visible character", apply: (text) => `\u00A0${text}` },
  { name: "a tab inside", apply: (text) => `${text}\t${text}` },
  { name: "a line break inside", apply: (text) => `${text}\n${text}` },
  { name: "a carriage return and a line break inside", apply: (text) => `${text}\r\n${text}` },
  { name: "a character past U+024F", apply: (text) => `${text}设` },
  { name: "a character outside the Basic Multilingual Plane", apply: (text) => `${text}\u{1F600}` },
  { name: "more than 16 characters", apply: (text) => text.padEnd(200, "x") },
];

/** Every character that `String.prototype.trim` removes. */
const TRIMMED: ReadonlyArray<string> = [
  " ",
  "\t",
  "\n",
  "\r",
  "\v",
  "\f",
  "\u00A0",
  "\u1680",
  ...Array.from({ length: 11 }, (_, index) => String.fromCharCode(0x2000 + index)),
  "\u2028",
  "\u2029",
  "\u202F",
  "\u205F",
  "\u3000",
  "\uFEFF",
];

/** Text that is empty or only whitespace, from every character `trim` removes. */
export const blank: Arbitrary.Arbitrary<string> = Arbitrary.array(
  between(0, TRIMMED.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(TRIMMED, index))),
  { maxLength: 4 },
).pipe(Arbitrary.map((chars) => chars.join("")));

/** The empty text, each whitespace character alone, and the drawn blank: every kind of blank text. */
export const blanksFrom = (drawn: string): ReadonlyArray<string> => ["", ...TRIMMED, drawn];

/** Good text, plain or made odd by a drawn kind. */
export const goodText: Arbitrary.Arbitrary<string> = Arbitrary.all({
  plain: nonBlank,
  kind: pick([{ apply: (plain: string) => plain }, ...TEXT_KINDS]),
}).pipe(Arbitrary.map(({ plain, kind }) => kind.apply(plain)));

/** A severity that is neither of the two, near misses included. */
export const otherSeverity: Arbitrary.Arbitrary<string> = pick([
  "",
  "info",
  "fatal",
  "note",
  "Error",
  "WARNING",
  "warn",
  "errors",
  " error",
]);

// ---- fields

/** One good place of any kind and class. */
const goodPlace: Arbitrary.Arbitrary<PlaceInput> = Arbitrary.all({
  parts: placeParts,
  index: between(0, 1000000),
}).pipe(
  Arbitrary.map(({ parts, index }) => {
    const every = goodPlaces(parts);

    return Arr.getUnsafe(every, index % every.length).value;
  }),
);

/** What a caller gives `report` beside the code: a good set of fields. */
export const goodFields = Arbitrary.all({
  severity: pick(["error", "warning"]),
  message: goodText,
  place: goodPlace,
  hint: goodText,
});

/** A set of good fields. */
type GoodFields = typeof goodFields extends Arbitrary.Arbitrary<infer Fields> ? Fields : never;

/** Drawn fields with drawn parts, from which `fieldVariants` makes the odd good ones. */
export const goodFieldsAndParts = Arbitrary.all({ fields: goodFields, parts: placeParts });

/**
 * The good fields made odd, one kind at a time: the message and the hint into each kind of text, and the place
 * into each class of each of the four kinds. Each is good, so each must be accepted and reported.
 */
export const fieldVariants = ({
  fields,
  parts,
}: {
  readonly fields: GoodFields;
  readonly parts: PlaceParts;
}): ReadonlyArray<GoodFields> => [
  ...TEXT_KINDS.map((kind) => ({ ...fields, message: kind.apply(fields.message), hint: kind.apply(fields.hint) })),
  ...classPlaces(parts).map((place) => ({ ...fields, place })),
];

// ---- one report, watched

/** One thing a handler reports: a code, which `make` declares, and good fields. */
export interface Item {
  readonly code: string;
  readonly fields: Parameters<typeof Diagnostics.report>[1];
}

/**
 * What a run of reports did: how it ended, what a fresh test Layer then held, and every span it made. The `before`
 * items are good and reported first; the last report takes any object as its fields, so a law can report one that
 * is no good: such a report dies, and that is what the law reads.
 */
export const observed = (code: string, fields: object, before: ReadonlyArray<Item> = []) =>
  Effect.gen(function* () {
    const delegate = yield* Tracer.Tracer;
    const spans: Array<Tracer.Span> = [];

    const tracer = Tracer.make({
      span(options) {
        const span = delegate.span(options);
        spans.push(span);

        return span;
      },
    });

    const declared = Diagnostic.make(code, { explain: "A long text." });
    // @ts-expect-error `fields` is any object, not `Fields`: this helper reports good fields and bad ones alike
    const last = Diagnostics.report(declared, fields);

    const earlier = Effect.forEach(
      before,
      (item) => Diagnostics.report(Diagnostic.make(item.code, { explain: "A long text." }), item.fields),
      { concurrency: 1, discard: true },
    );

    const { exit, reported } = yield* earlier.pipe(
      Effect.andThen(last),
      Effect.exit,
      Effect.flatMap((exit) => Effect.map(TestDiagnostics.reported, (reported) => ({ exit, reported }))),
      Effect.withTracer(tracer),
      Effect.provide(TestDiagnostics.layer),
    );

    return { exit, reported, spans };
  });
