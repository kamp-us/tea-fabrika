// Redact: scrub secrets from an agent run's saved files, and run an agent with no secret in reach.
// This file is the contract and its pure rules (0095): `RedactFs.layer` does the work on the disk
// and a child process, `RedactTest.layer` answers from memory. Today's lead tooling, [secrets].
//
// The rules are redact.sh's, kept exact:
//   - a secret is the value of any environment name holding TOKEN, SECRET, KEY, PASSWORD or _AUTH,
//     or starting NPM_CONFIG_, matched without case
//   - a token is any of npm_, ghp_, gho_, github_pat_ or sk- and 16 or more of [A-Za-z0-9_-] (the
//     lengths leakgrep.sh cites from gitleaks), and a PEM private key block runs to its END line or,
//     cut short by a crash, to the end of the text
//   - each is found at every decoding depth, raw and through up to six rounds of JSON string
//     escapes and URL escapes, and the saved spelling it was found in is replaced whole, by
//     `[redacted]`; nothing else changes
import { Context } from "effect";
import type { Effect } from "effect";

/** One agent run: in `cwd`, fed `prompt`, its last message saved to `answer` and its output to `events`. */
export type Ask = {
  readonly cwd: string;
  readonly prompt: string;
  readonly answer: string;
  readonly events: string;
  /** The command and its words, run as given. */
  readonly command: ReadonlyArray<string>;
};

/** How a run ended: its exit code, and the spans redacted, or null when the scrub failed and both files went. */
export type Ran = { readonly code: number; readonly redacted: number | null };

/** A scrub of named files: the spans redacted, and each file that could not be scrubbed and was removed. */
export type Files = { readonly count: number; readonly failed: ReadonlyArray<string> };

export class Redact extends Context.Service<
  Redact,
  {
    /** Scrub each file in place; a file that cannot be read or written is removed. Never fails. */
    readonly files: (paths: ReadonlyArray<string>) => Effect.Effect<Files>;
    /**
     * Run `ask.command` with no secret in its environment and a blank npm config, then scrub both
     * saved files before the project's `.npmrc` goes back; a failed scrub removes both. Never fails.
     */
    readonly run: (ask: Ask) => Effect.Effect<Ran>;
  }
>()("lead/redact/Redact") {}

/** An environment name whose value is a secret. */
export const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|_AUTH|^NPM_CONFIG_/i;

/** The secret values of an environment: every set, non-empty value under a secret name. */
export const secretValues = (env: Readonly<Record<string, string | undefined>>): ReadonlyArray<string> =>
  Object.entries(env).flatMap(([name, value]) =>
    SECRET_NAME.test(name) && value !== undefined && value !== "" ? [value] : [],
  );

const PATTERNS = [
  /(?:npm_|ghp_|gho_|github_pat_|sk-)[A-Za-z0-9_-]{16,}/g,
  // A block cut short by a crash still holds key bytes: it runs to the end of the text.
  /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g,
];

/** One saved escape: a surrogate pair first, so an escaped emoji decodes as one character. */
const ESCAPE =
  /\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\[nrtbf"/\\]|(?:%[0-9a-fA-F]{2})+/g;

/** How many rounds of decoding are searched, past the saved text itself. */
const ROUNDS = 6;

const JSON_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  '"': '"',
  "/": "/",
  "\\": "\\",
};

/** UTF-8 that keeps a leading byte-order mark and reads a bad byte as U+FFFD, as Python's `unquote` does. */
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

/** One escape's value: a run of `%HH` read as UTF-8, a `\u` escape as its code units, a JSON escape as its mark. */
const unescape = (word: string): string => {
  if (word.startsWith("%")) {
    return utf8.decode(Uint8Array.from(word.slice(1).split("%"), (hex) => Number.parseInt(hex, 16)));
  }

  if (word.startsWith("\\u")) {
    return word
      .split("\\u")
      .slice(1)
      .map((hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .join("");
  }

  return JSON_ESCAPES[word.slice(1)] ?? word;
};

/**
 * Where each code unit of a decoded text came from in the saved text: `from[i]` to `to[i]`. A
 * decoded mark covers its whole escape, so a match maps back to the saved spelling it was found in.
 */
type Spans = { readonly from: ReadonlyArray<number>; readonly to: ReadonlyArray<number> };

/** Every match of a token, a key block or a secret in `text`, as a range of the saved text. */
const found = (text: string, spans: Spans, secrets: ReadonlyArray<string>): Array<readonly [number, number]> => {
  const hits: Array<readonly [number, number]> = [];

  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      hits.push([m.index, m.index + m[0].length]);
    }
  }

  for (const secret of secrets) {
    if (secret === "") {
      continue;
    }

    for (let i = text.indexOf(secret); i >= 0; i = text.indexOf(secret, i + secret.length)) {
      hits.push([i, i + secret.length]);
    }
  }

  return hits.filter(([a, b]) => b > a).map(([a, b]) => [spans.from[a] ?? a, spans.to[b - 1] ?? b] as const);
};

/** One round of decoding: each escape read once, with where each new code unit came from. */
const decodeOnce = (text: string, spans: Spans): { readonly text: string; readonly spans: Spans } => {
  const out: Array<string> = [];
  const from: Array<number> = [];
  const to: Array<number> = [];
  let at = 0;
  const keep = (end: number) => {
    out.push(text.slice(at, end));

    for (let i = at; i < end; i++) {
      from.push(spans.from[i] ?? i);
      to.push(spans.to[i] ?? i + 1);
    }
  };

  for (const m of text.matchAll(ESCAPE)) {
    keep(m.index);
    const value = unescape(m[0]);
    const end = m.index + m[0].length;
    out.push(value);

    for (let i = 0; i < value.length; i++) {
      from.push(spans.from[m.index] ?? m.index);
      to.push(spans.to[end - 1] ?? end);
    }

    at = end;
  }

  keep(text.length);
  return { text: out.join(""), spans: { from, to } };
};

/**
 * `text` with every token, key block and secret replaced by `[redacted]`, found raw and through up
 * to six rounds of JSON and URL escapes, and how many spans were replaced. Overlapping or touching
 * spans count once; text outside them is kept as it was.
 */
export const scrub = (
  text: string,
  secrets: ReadonlyArray<string>,
): { readonly text: string; readonly count: number } => {
  const start = Array.from({ length: text.length }, (_, i) => i);
  let decoded = { text, spans: { from: start, to: start.map((i) => i + 1) } as Spans };
  const ranges = found(decoded.text, decoded.spans, secrets);

  for (let round = 0; round < ROUNDS; round++) {
    const next = decodeOnce(decoded.text, decoded.spans);

    if (next.text === decoded.text) {
      break;
    }

    decoded = next;

    for (const range of found(decoded.text, decoded.spans, secrets)) {
      ranges.push(range);
    }
  }

  const merged: Array<[number, number]> = [];

  for (const [a, b] of ranges.toSorted((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = merged.at(-1);

    if (last !== undefined && a <= last[1]) {
      last[1] = Math.max(b, last[1]);
    } else {
      merged.push([a, b]);
    }
  }

  const kept: Array<string> = [];
  let at = 0;

  for (const [a, b] of merged) {
    kept.push(text.slice(at, a), "[redacted]");
    at = b;
  }

  kept.push(text.slice(at));
  return { text: kept.join(""), count: merged.length };
};
