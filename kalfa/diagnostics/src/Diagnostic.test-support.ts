// What the laws of this package's three modules share: generators for good and broken codes, places and
// texts. Each law applies every break to each good value it draws, so each case a law must reach is in every
// run, and no run can pass on less.
import { Arbitrary, Array as Arr, Schema } from "effect";

/** The shared seed (AGENTS.md), so a red run repeats. */
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

/** A place as a caller writes it. */
interface PlaceInput {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

// A segment never starts with a dot, so it is never "." or "..".
const segment = pattern(/^[a-zA-Z0-9_~@+()-][a-zA-Z0-9_~@+().-]{0,5}$/);

/** The parts of a place that has a file, a line and a column, and where a break goes in the path. */
interface PlaceParts {
  readonly segments: ReadonlyArray<string>;
  readonly line: number;
  readonly column: number;
  readonly at: number;
}

/** Parts that make good places and broken ones. */
export const placeParts: Arbitrary.Arbitrary<PlaceParts> = Arbitrary.all({
  segments: Arbitrary.array(segment, { minLength: 1, maxLength: 4 }),
  line: between(1, 100000),
  column: between(1, 500),
  at: between(0, 4),
});

/** The four kinds of good place these parts make: the whole repo, a path, a path and line, and with a column. */
export const goodPlaces = ({ segments, line, column }: PlaceParts): ReadonlyArray<PlaceInput> => {
  const path = segments.join("/");

  return [{ path: "." }, { path }, { path, line }, { path, line, column }];
};

const through = ({ segments, at }: PlaceParts, item: string): string =>
  segments.toSpliced(at % (segments.length + 1), 0, item).join("/");

/** Every way to break a place that the place's rules refuse. */
export const PLACE_BREAKS: ReadonlyArray<Break<PlaceParts, PlaceInput>> = [
  { name: "an empty path", apply: () => ({ path: "" }) },
  { name: "a leading slash", apply: ({ segments }) => ({ path: `/${segments.join("/")}` }) },
  { name: "a ./ start", apply: ({ segments }) => ({ path: `./${segments.join("/")}` }) },
  { name: "a .. segment", apply: (parts) => ({ path: through(parts, "..") }) },
  { name: "a . segment", apply: (parts) => ({ path: through(parts, ".") }) },
  { name: "an empty segment", apply: (parts) => ({ path: through(parts, "") }) },
  { name: "a trailing slash", apply: ({ segments }) => ({ path: `${segments.join("/")}/` }) },
  { name: "a backslash", apply: ({ segments }) => ({ path: `${segments.join("/")}\\x` }) },
  { name: "a line of 0", apply: ({ segments }) => ({ path: segments.join("/"), line: 0 }) },
  { name: "a negative line", apply: ({ segments, line }) => ({ path: segments.join("/"), line: -line }) },
  { name: "a fractional line", apply: ({ segments, line }) => ({ path: segments.join("/"), line: line + 0.5 }) },
  { name: "a column of 0", apply: ({ segments, line }) => ({ path: segments.join("/"), line, column: 0 }) },
  {
    name: "a negative column",
    apply: ({ segments, line, column }) => ({ path: segments.join("/"), line, column: -column }),
  },
  {
    name: "a fractional column",
    apply: ({ segments, line, column }) => ({ path: segments.join("/"), line, column: column + 0.5 }),
  },
  { name: "a column with no line", apply: ({ segments, column }) => ({ path: segments.join("/"), column }) },
  { name: "a line on the whole repo", apply: ({ line }) => ({ path: ".", line }) },
];

/** One good place, of any of the four kinds. */
const goodPlace: Arbitrary.Arbitrary<PlaceInput> = Arbitrary.all({
  parts: placeParts,
  kind: between(0, 3),
}).pipe(Arbitrary.map(({ parts, kind }) => Arr.getUnsafe(goodPlaces(parts), kind)));

/** One broken place, of any of the breaks. */
export const brokenPlace: Arbitrary.Arbitrary<PlaceInput> = Arbitrary.all({
  parts: placeParts,
  broken: pick(PLACE_BREAKS),
}).pipe(Arbitrary.map(({ parts, broken }) => broken.apply(parts)));

// ---- texts

/** Some text that is not only spaces: it starts with a visible character, and may hold spaces after. */
export const nonBlank: Arbitrary.Arbitrary<string> = pattern(/^[!-~¡-ɏ][ -~¡-ɏ]{0,15}$/);

/** Text that is empty or only spaces, tabs and line breaks. */
export const blank: Arbitrary.Arbitrary<string> = pattern(/^[ \t\n]{0,4}$/);

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

/** What a caller gives `report` beside the code: a good set of fields. */
export const goodFields = Arbitrary.all({
  severity: pick(["error", "warning"]),
  message: nonBlank,
  place: goodPlace,
  hint: nonBlank,
});
