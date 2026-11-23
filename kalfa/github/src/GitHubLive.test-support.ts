// What the laws of the live Layer share: the generators, and the helpers that build a reply, the settings and a request. The stand-in for
// `fetch` is in GitHubLive.test.ts, since it makes Promises. Each law applies, to each value it draws, one made from it for every class of odd value, so every case a law must reach is
// in every run and no run can pass on less.
import { Arbitrary, Array as Arr, Schema } from "effect";
import { between, word } from "./GitHub.test-support.ts";
import * as GitHub from "./GitHub.ts";
import * as Settings from "./Settings.ts";

/** One of the choices. */
export const pick = <const A>(choices: ReadonlyArray<A>): Arbitrary.Arbitrary<A> =>
  between(0, choices.length - 1).pipe(Arbitrary.map((index) => Arr.getUnsafe(choices, index)));

/** A reply of the kind GitHub sends: a text body, a status, and a media type. */
export const reply = (
  body: BodyInit | null,
  status = 200,
  headers: HeadersInit = { "content-type": "application/json; charset=utf-8" },
): Response => new Response(body, { status, headers });

/** The settings values the Layer reads, made through the settings' own Schemas, so only a value that passed reaches it. */
export const liveSettings = (options: { readonly apiUrl?: string; readonly redirects?: number }): Settings.Values => ({
  apiUrl: Schema.decodeUnknownSync(Settings.ApiUrl)(options.apiUrl ?? "https://api.github.com"),
  pollInterval: Schema.decodeUnknownSync(Settings.PollInterval)("30 seconds"),
  redirects: Schema.decodeUnknownSync(Settings.Redirects)(options.redirects ?? 20),
});

/** A request the service is handed by hand, as `call` would build it. */
export const makeRequest = (parts: {
  readonly method: GitHub.Method;
  readonly path: string;
  readonly query?: GitHub.Request["query"];
  readonly body?: GitHub.Request["body"];
  readonly auth: GitHub.Auth;
  readonly accept?: string;
  readonly route?: GitHub.RouteName;
}): GitHub.Request => ({
  route: parts.route ?? "GET /repos/{owner}/{repo}",
  method: parts.method,
  path: parts.path,
  params: {},
  query: parts.query ?? {},
  auth: parts.auth,
  ...(parts.body === undefined ? {} : { body: parts.body }),
  ...(parts.accept === undefined ? {} : { accept: parts.accept }),
});

/** `send` on the service. */
export const send = (request: GitHub.Request) => GitHub.GitHub.use((service) => service.send(request));

// ---- hosts and addresses

const LABEL_HEADS = ["a", "b", "h", "k", "q", "x"] as const;

const LABEL_BODY = ["a", "c", "0", "7", "-", "m"] as const;

const LABEL_TAILS = ["e", "n", "3", "z"] as const;

/** A host label: it starts and ends with a letter or a digit, so it is one a URL keeps as it was written. */
const label: Arbitrary.Arbitrary<string> = Arbitrary.all({
  head: pick(LABEL_HEADS),
  body: Arbitrary.array(pick(LABEL_BODY), { maxLength: 5 }),
  tail: pick(LABEL_TAILS),
}).pipe(Arbitrary.map(({ head, body, tail }) => `${head}${body.join("")}${tail}`));

/** A host that is none of GitHub's, in the lower case a URL writes it. */
export const host: Arbitrary.Arbitrary<string> = Arbitrary.all({
  one: label,
  two: label,
  tld: pick(["test", "example", "invalid"]),
}).pipe(Arbitrary.map(({ one, two, tld }) => `${one}.${two}.${tld}`));

/**
 * What the laws of the live Layer draw for an address: its host and port, another host (one label longer, so never the same), and
 * another port (above the first, so never the same).
 */
export const addresses = Arbitrary.all({
  host,
  other: host.pipe(Arbitrary.map((each) => `far.${each}`)),
  port: between(1025, 30000),
  otherPort: between(30001, 60000),
  marker: word,
});

/** An address class: its text, and where it is accepted. */
interface Address {
  readonly name: string;
  readonly value: string;
}

/**
 * The addresses a setting takes: (k) GitHub's own and a generated host, each with and without a trailing `/`; (l) a path prefix,
 * with and without a trailing `/`, and a port.
 */
export const goodAddresses = (host: string, port: number): ReadonlyArray<Address> => [
  { name: "k: GitHub's own", value: "https://api.github.com" },
  { name: "k: GitHub's own, a trailing slash", value: "https://api.github.com/" },
  { name: "k: a host", value: `https://${host}` },
  { name: "k: a host, a trailing slash", value: `https://${host}/` },
  { name: "l: a path prefix", value: `https://${host}/api/v3` },
  { name: "l: a path prefix, a trailing slash", value: `https://${host}/api/v3/` },
  { name: "l: a port", value: `https://${host}:${port}` },
  { name: "l: a port and a prefix", value: `https://${host}:${port}/api/v3` },
  { name: "l: a port and a prefix, a trailing slash", value: `https://${host}:${port}/api/v3/` },
];

/**
 * The addresses a setting refuses, each kind (m) passing the checks before its own: the user, the query and the fragment are
 * `https:` addresses that parse. `marker` is in each, so a message that shows any part of the text is seen.
 */
export const badAddresses = (host: string, drawn: string): ReadonlyArray<Address> => {
  // Letters and digits only, so the marker is a user, a query or a fragment where it is put, and never a path or a host of its own.
  const marker = `qz9${drawn.replace(/[^A-Za-z0-9]/gu, "")}`;

  return [
    { name: "m: http", value: `http://${marker}.${host}` },
    { name: "m: ftp", value: `ftp://${marker}.${host}` },
    { name: "m: no scheme", value: `${marker}.${host}` },
    { name: "m: no URL", value: `not an address ${marker}` },
    { name: "m: empty", value: "" },
    { name: "m: a user", value: `https://${marker}@${host}` },
    { name: "m: a user and a password", value: `https://user:${marker}@${host}` },
    { name: "m: a password alone", value: `https://:${marker}@${host}` },
    { name: "m: a query", value: `https://${host}/api/v3?${marker}=1` },
    { name: "m: a query on the root", value: `https://${host}?${marker}` },
    { name: "m: a fragment", value: `https://${host}/api/v3#${marker}` },
  ];
};

// ---- queries and bodies

/** Marks a URL treats as its own, in a query's keys and values. */
const MARKS = ["&", "=", "+", "#", "%", "?", " ", "/", "é", "ş", "设", "😀", "%20", "a b"] as const;

/** A text for a query: a word with marks of a URL in it. */
export const queryText: Arbitrary.Arbitrary<string> = Arbitrary.all({
  base: word,
  marks: Arbitrary.array(pick(MARKS), { minLength: 1, maxLength: 3 }),
}).pipe(Arbitrary.map(({ base, marks }) => `${base}${marks.join("")}${base}`));

/** What a query value is: a text, a number, a boolean, or a list of them. */
type QueryValue = GitHub.QueryValue;

/** A query for each class: (n) texts with marks of a URL; (o) lists, empty, one item and many, numbers and booleans, none at all. */
export const queryClasses = (
  one: string,
  two: string,
  count: number,
): ReadonlyArray<{
  readonly name: string;
  readonly query: Readonly<Record<string, QueryValue>>;
}> => [
  { name: "o: no query", query: {} },
  { name: "n: marks in a value", query: { q: one } },
  { name: "n: marks in a key and a value", query: { [one]: two } },
  { name: "n: two keys", query: { per_page: count, [two]: one } },
  { name: "o: a number and a boolean", query: { per_page: count, page: 0 - count, draft: count % 2 === 0 } },
  { name: "o: an empty list", query: { exclude: [] } },
  { name: "o: a list of one", query: { exclude: [one] } },
  { name: "o: a list of many", query: { exclude: [one, two, `${count}`, one] } },
  { name: "o: a list of mixed values", query: { owner: [one, count, count % 2 === 0] } },
  { name: "o: an empty list and a text", query: { exclude: [], q: two } },
];

/** The text a query is written as: each key and value as `URLSearchParams` writes them, a list as its key repeated. */
export const queryString = (query: Readonly<Record<string, QueryValue>>): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      params.append(key, String(each));
    }
  }

  return params.toString();
};

/** A JSON body of each kind: an object with nested lists and objects, a list, texts with marks. */
export const bodyClasses = (
  one: string,
  count: number,
): ReadonlyArray<{ readonly name: string; readonly body: Schema.Json }> => [
  { name: "an object", body: { title: one, number: count, done: false } },
  { name: "a nested object", body: { a: { b: [one, { c: count }], d: null }, e: [] } },
  { name: "a list", body: [one, count, true, null] },
  { name: "a text with marks", body: { text: `${one}"\\\n\t😀` } },
];

// ---- tokens

/**
 * GitHub's token shapes, and RFC 6750's `token68` text: `ghp_`, `github_pat_`, `ghs_` and `gho_` with generated bodies, a JWT
 * of three base64url parts, and random `token68` text. `marker` is in each, so a place that shows any part of it is seen.
 */
export const goodTokens = (
  marker: string,
  length: number,
): ReadonlyArray<{ readonly name: string; readonly token: string }> => {
  const body = `zq${length.toString(36)}${marker.replace(/[^A-Za-z0-9]/gu, "")}`;

  return [
    { name: "p: ghp_", token: `ghp_${body}` },
    { name: "p: github_pat_", token: `github_pat_${body}_${body}` },
    { name: "p: ghs_", token: `ghs_${body}` },
    { name: "p: gho_", token: `gho_${body}` },
    {
      name: "p: a JWT",
      token: `${btoa(`{"alg":"${body}"}`).replace(/=+$/u, "")}.${btoa(`{"sub":"${body}"}`).replace(/=+$/u, "")}.${body}`,
    },
    { name: "p: token68 text with padding", token: `${body}-._~+/=` },
  ];
};

/**
 * A token a header cannot carry (q): with CR, LF, NUL, a space, a tab, letters past Latin-1 and `=` in the middle, and the empty
 * text. A token that is not `token68` is refused whole, so each holds `marker` as well.
 */
export const badTokens = (marker: string): ReadonlyArray<{ readonly name: string; readonly token: string }> => {
  const body = `zq${marker.replace(/[^A-Za-z0-9]/gu, "")}`;

  return [
    { name: "q: a carriage return", token: `ghp_${body}\rx` },
    { name: "q: a line feed", token: `ghp_${body}\nx` },
    { name: "q: a trailing line feed", token: `ghp_${body}\n` },
    { name: "q: NUL", token: `ghp_${body}\u0000x` },
    { name: "q: a space", token: `ghp_${body} x` },
    { name: "q: a tab", token: `ghp_${body}\tx` },
    { name: "q: letters past Latin-1", token: `ghp_${body}设x` },
    { name: "q: = in the middle", token: `ghp_${body}=x` },
    { name: "q: empty", token: "" },
  ];
};

/** Whether a text is anywhere in `texts`. */
export const showsAny = (texts: ReadonlyArray<string>, forms: ReadonlyArray<string>): ReadonlyArray<string> =>
  forms.filter((form) => form !== "" && texts.some((each) => each.includes(form)));
