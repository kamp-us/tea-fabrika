// The laws of the remote values and the credential (F15 and F16): the URL a fetch takes, the name of a remote, and the login the slot
// gives. Every class a generator must reach is applied to each run's drawn value, and the law names the classes it needs, so a class
// dropped from a generator fails here loudly.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Redacted, Result, Schema } from "effect";
import * as Credentials from "./Credentials.ts";
import { CREDENTIAL_CLASSES, credentialArb, credentialText } from "./Fetch.test-support.ts";
import { branchAccepted, branchRefused, partArb } from "./History.test-support.ts";
import * as Ref from "./Ref.ts";
import * as Remote from "./Remote.ts";

const RUNS = { arbitrary: { runs: 200, seed: 119120 } };

const label = (alphabet: string, most: number): Arbitrary.Arbitrary<string> =>
  Arbitrary.array(Arbitrary.schema(Schema.Literals([...alphabet])), { minLength: 2, maxLength: most }).pipe(
    Arbitrary.map((characters) => characters.join("")),
  );

/** What one run draws to make URLs: a host, a port, and two names of a path, all plain letters and digits. */
const urlArb = Arbitrary.all({
  host: label("abcdefghijklmnopqrstuvwxyz0123456789", 10),
  domain: label("abcdefghijklmnopqrstuvwxyz", 6),
  first: label("abcdefghijklmnopqrstuvwxyz0123456789", 8),
  second: label("abcdefghijklmnopqrstuvwxyz0123456789", 8),
  port: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))),
});

/** What the URL parser drops, maps or decodes, so a host reads as another host than the text says. */
const HIDING: ReadonlyArray<readonly [label: string, character: string]> = [
  ["a zero width space", "\u200B"],
  ["a byte order mark", "\uFEFF"],
  ["a combining grapheme joiner", "\u034F"],
  ["a soft hyphen", "\u00AD"],
  ["a word joiner", "\u2060"],
  ["a variation selector", "\uFE0F"],
  ["a fullwidth letter", "\uFF45"],
  ["a fullwidth dot", "\uFF0E"],
];

type Drawn = typeof urlArb extends Arbitrary.Arbitrary<infer A> ? A : never;

/** The texts a fetch takes, one for each accepted class. */
const ACCEPTED = (drawn: Drawn): ReadonlyArray<readonly [label: string, text: string]> => [
  ["https with a host and a path", `https://${drawn.host}.${drawn.domain}/${drawn.first}`],
  [
    "https with a port and a deeper path",
    `https://${drawn.host}.${drawn.domain}:${drawn.port}/${drawn.first}/${drawn.second}.git`,
  ],
  ["an upper-case host", `https://${`${drawn.host}.${drawn.domain}`.toUpperCase()}/${drawn.first}`],
  ["an IPv6 host with a port", `https://[::1]:8443/${drawn.first}`],
  ["an xn-- name", `https://xn--${drawn.host}-${drawn.domain}.test/${drawn.first}`],
  ["a file URL", `file:///${drawn.first}/${drawn.second}.git`],
  ["an absolute path", `/${drawn.first}/${drawn.second}.git`],
];

/** The texts it refuses: (w) a control character the parser drops, (x) a user, (y) plain http, (z) every other form. */
const REFUSED = (drawn: Drawn): ReadonlyArray<readonly [label: string, text: string]> => {
  const host = `${drawn.host}.${drawn.domain}`;

  return [
    // (w) the WHATWG parser drops a tab, a line feed and a carriage return, so `https://exa<TAB>mple.com/r` reads as `example.com`.
    [
      "(w) a tab inside the host",
      `https://${drawn.host.slice(0, 1)}\t${drawn.host.slice(1)}.${drawn.domain}/${drawn.first}`,
    ],
    [
      "(w) a line feed inside the host",
      `https://${drawn.host.slice(0, 1)}\n${drawn.host.slice(1)}.${drawn.domain}/${drawn.first}`,
    ],
    [
      "(w) a carriage return inside the host",
      `https://${drawn.host.slice(0, 1)}\r${drawn.host.slice(1)}.${drawn.domain}/${drawn.first}`,
    ],
    ["(w) a tab inside the path", `https://${host}/${drawn.first}\t${drawn.second}`],
    ["(w) a control character inside the path", `https://${host}/${drawn.first}\u0001${drawn.second}`],
    ["(w) a space inside the path", `https://${host}/${drawn.first} ${drawn.second}`],
    ["(w) a control character in a path", `/${drawn.first}\n/${drawn.second}`],
    // (w) a backslash, which the parser reads as a slash in an https URL, and git reads as part of a name in a path.
    ["(w) a backslash in an absolute path", `/${drawn.first}\\${drawn.second}`],
    ["(w) a backslash after the host", `https://${host}\\${drawn.first}`],
    // (h) the parser reads another host than the text says: it drops or maps a character, or decodes a percent-encoded one.
    ...HIDING.map(([label, character]): readonly [string, string] => [
      `(h) a host hidden by ${label}`,
      `https://${drawn.host.slice(0, 1)}${character}${drawn.host.slice(1)}.${drawn.domain}/${drawn.first}`,
    ]),
    [
      "(h) a host hidden by a percent-encoded letter",
      `https://${drawn.host.slice(0, 1)}%${drawn.host.charCodeAt(1).toString(16).toUpperCase()}${drawn.host.slice(2)}.${drawn.domain}/${drawn.first}`,
    ],
    [
      "(h) a host hidden by a fullwidth capital letter inside an upper-case host",
      `https://${host.toUpperCase().slice(0, 1)}\uFF25${host.toUpperCase().slice(1)}/${drawn.first}`,
    ],
    [
      "(h) a host hidden by a zero width space inside an upper-case host",
      `https://${host.toUpperCase().slice(0, 1)}\u200B${host.toUpperCase().slice(1)}/${drawn.first}`,
    ],
    // The Kelvin sign is `K` to the parser, and lowercases to `k` in Unicode, so only a lowercase of ASCII letters leaves it as it is.
    ["(h) a host hidden by a Kelvin sign", `https://\u212A${host}/${drawn.first}`],
    // (x) no login rides in a URL.
    ["(x) a user", `https://${drawn.first}@${host}/${drawn.second}`],
    ["(x) a user and a password", `https://${drawn.first}:${drawn.second}@${host}/r`],
    ["(x) an empty user", `https://@${host}/${drawn.first}`],
    ["(x) an empty user and an empty password", `https://:@${host}/${drawn.first}`],
    // (y) plain http to a host that is not this machine.
    ["(y) http to another host", `http://${host}/${drawn.first}`],
    ["(y) http with a port", `http://${host}:${drawn.port}/${drawn.first}`],
    // (z) every other form.
    ["(z) a relative path", `${drawn.first}/${drawn.second}.git`],
    ["(z) a dot path", `./${drawn.first}`],
    ["(z) a parent path", `../${drawn.first}`],
    ["(z) a leading dash", `-${drawn.first}`],
    ["(z) an option", `--upload-pack=${drawn.first}`],
    ["(z) the ext transport", `ext::${drawn.first}`],
    ["(z) the fd transport", `fd::${drawn.port}`],
    ["(z) ssh", `ssh://${host}/${drawn.first}`],
    ["(z) two leading slashes", `//${host}/${drawn.first}`],
    ["(z) a file URL with one slash", `file:/${drawn.first}/${drawn.second}.git`],
    ["(z) a file URL with a host", `file://${host}/${drawn.first}`],
    ["(z) a file URL whose path starts with two slashes", `file:////${drawn.first}/${drawn.second}.git`],
    ["(z) https with one slash", `https:/${host}/${drawn.first}`],
    ["(z) https with no slash", `https:${host}/${drawn.first}`],
    ["(z) git's short ssh form", `git@${host}:${drawn.first}/${drawn.second}.git`],
    ["(z) another scheme", `ftp://${host}/${drawn.first}`],
    ["(z) a query", `https://${host}/${drawn.first}?x=${drawn.second}`],
    ["(z) a fragment", `https://${host}/${drawn.first}#${drawn.second}`],
    ["(z) the empty text", ""],
  ];
};

const URL_CLASSES = [
  "https with a host and a path",
  "https with a port and a deeper path",
  "an upper-case host",
  "an IPv6 host with a port",
  "an xn-- name",
  "a file URL",
  "an absolute path",
  "(w) a tab inside the host",
  "(w) a line feed inside the host",
  "(w) a carriage return inside the host",
  "(w) a tab inside the path",
  "(w) a control character inside the path",
  "(w) a space inside the path",
  "(w) a control character in a path",
  "(w) a backslash in an absolute path",
  "(w) a backslash after the host",
  ...HIDING.map(([label]) => `(h) a host hidden by ${label}`),
  "(h) a host hidden by a percent-encoded letter",
  "(h) a host hidden by a fullwidth capital letter inside an upper-case host",
  "(h) a host hidden by a zero width space inside an upper-case host",
  "(h) a host hidden by a Kelvin sign",
  "(x) a user",
  "(x) a user and a password",
  "(x) an empty user",
  "(x) an empty user and an empty password",
  "(y) http to another host",
  "(y) http with a port",
  "(z) a relative path",
  "(z) a dot path",
  "(z) a parent path",
  "(z) a leading dash",
  "(z) an option",
  "(z) the ext transport",
  "(z) the fd transport",
  "(z) ssh",
  "(z) two leading slashes",
  "(z) a file URL with one slash",
  "(z) a file URL with a host",
  "(z) a file URL whose path starts with two slashes",
  "(z) https with one slash",
  "(z) https with no slash",
  "(z) git's short ssh form",
  "(z) another scheme",
  "(z) a query",
  "(z) a fragment",
  "(z) the empty text",
];

// Plant (F15): delete the control character check, so the tab and line feed URLs pass (w); delete the user check, so `https://u:p@host/r` passes
// (x); take `http` to any host (y); take a relative path (z); take `ext::` (z); delete the host check, so a hidden host (h) passes; delete the
// backslash from the hidden characters (w); take two leading slashes as a path (z); delete the `file:///` prefix check (z); compare the host after
// `normalize("NFKC").toLowerCase()`, a case-blind compare that also ignores the hiding characters (h); delete the check that a file path does not start
// with two slashes (z); refuse an upper-case host (the accepted classes).
it.prop(
  "F15 the URL: every text of (h) and (w) to (z) is refused, a host the parser reads as another host included, and an https URL with a host and a path, with a port, a file URL and an absolute path each decode to themselves",
  { drawn: urlArb },
  ({ drawn }) => {
    const accepted = ACCEPTED(drawn);
    const refused = REFUSED(drawn);

    expect(
      [...accepted, ...refused].map(([name]) => name),
      "the generator reaches every class",
    ).toEqual(URL_CLASSES);

    for (const [name, text] of accepted) {
      const result = Schema.decodeUnknownResult(Remote.Url)(text);
      expect(Result.isSuccess(result), `${name} is accepted: ${JSON.stringify(text)}`).toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success, `${name} decodes to itself`).toBe(text);
      }
    }

    // A class of (h) really is one the parser reads as another host: it parses, and its host is not the text's authority.
    for (const [name, text] of refused) {
      if (name.startsWith("(h)")) {
        const authority = text.slice(text.indexOf("//") + 2).split("/")[0];
        expect(URL.canParse(text), `${name} parses`).toBe(true);
        expect(
          new URL(text).host,
          `${name} reads as another host than its text, and not by capital letters alone`,
        ).not.toBe(authority?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()));
      }
    }

    for (const [name, text] of refused) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(Remote.Url)(text)),
        `${name} is refused: ${JSON.stringify(text)}`,
      ).toBe(true);
    }
  },
  RUNS,
);

/** Every text a remote's name is tried with: a good one, a leading dash, and the branch names git accepts and refuses. */
const nameCandidates = (part: string): ReadonlyArray<readonly [label: string, text: string]> => [
  ["a plain name", part],
  ["a name below a folder", `${part}/sub`],
  ["a dash first", `-${part}`],
  ["the empty text", ""],
  ["a name ending .lock", `${part}.lock`],
  ["a name with a space", `${part} x`],
  ...branchAccepted(part).map(([name, text]): readonly [string, string] => [`accepted branch: ${name}`, text]),
  ...branchRefused(part).map(([name, text]): readonly [string, string] => [`refused branch: ${name}`, text]),
];

// Plant (F16): take `-x` as a name; decide a name by `Ref.BranchName` and not by `refs/remotes/<name>/x`; drop the line check on the
// password; declare the password `Schema.String`, so JSON holds it.
it.prop(
  "F16 the name and the credential: a name passes exactly when refs/remotes/<name>/x is a ref name and it does not start with a dash; a credential refuses a CR, LF or NUL in either field, its password decodes to Redacted that prints <redacted>, and encoding the credential as JSON fails",
  { part: partArb, credential: credentialArb },
  ({ part, credential }) => {
    const candidates = nameCandidates(part);
    expect(candidates.length, "the generator reaches every name class").toBeGreaterThan(40);

    for (const [name, text] of candidates) {
      const expected = Schema.is(Ref.RefName)(`refs/remotes/${text}/x`) && !text.startsWith("-");
      expect(Schema.is(Remote.Name)(text), `${name}: ${JSON.stringify(text)}`).toBe(expected);
    }

    expect(credential.classes, "the generator reaches every credential class").toEqual(CREDENTIAL_CLASSES);

    const codec = Schema.toCodecJson(Credentials.Credential);
    const made = Schema.decodeUnknownResult(codec)({ username: credential.username, password: credential.password });
    expect(Result.isSuccess(made), "a good credential decodes").toBe(true);

    if (Result.isSuccess(made)) {
      expect(made.success.username).toBe(credential.username);
      expect(Redacted.isRedacted(made.success.password), "the password is Redacted").toBe(true);
      expect(Redacted.value(made.success.password), "and it holds the password").toBe(credential.password);
      expect(String(made.success.password), "it prints <redacted>").toBe("<redacted>");
      expect(JSON.stringify(made.success), "JSON holds no password").not.toContain(credential.password);
      expect(Result.isFailure(Result.try(() => Schema.encodeSync(codec)(made.success))), "no JSON form").toBe(true);
    }

    for (const bad of ["\r", "\n", "\0"]) {
      const inUser = Schema.decodeUnknownResult(codec)({
        username: credentialText(credential.username, bad),
        password: credential.password,
      });

      const inPassword = Schema.decodeUnknownResult(codec)({
        username: credential.username,
        password: credentialText(credential.password, bad),
      });

      expect(Result.isFailure(inUser), `a ${JSON.stringify(bad)} in the user name is refused`).toBe(true);
      expect(Result.isFailure(inPassword), `a ${JSON.stringify(bad)} in the password is refused`).toBe(true);
    }
  },
  RUNS,
);
