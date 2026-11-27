/**
 * The remote a fetch reads from, by name or by URL, and the failures of finding it and of reading from it.
 *
 * **Details**
 *
 * A remote is named in this repository's config, such as `origin`, or it is a URL. A URL is one this package takes: it holds no login, so no credential can ride in it, and no text the URL parser would drop can hide a host.
 */
import { Schema } from "effect";
import * as Ref from "./Ref.ts";

// A name is a ref name below `refs/remotes/`, since git keeps a remote's refs there, and it never starts with `-`, so git never reads it as an option.
const isName = (text: string): boolean => Schema.is(Ref.RefName)(`refs/remotes/${text}/x`) && !text.startsWith("-");

/**
 * Schema for a remote's name in this repository's config, such as `origin`.
 *
 * **Details**
 *
 * With `refs/remotes/` in front and `/x` after it, the name is a `RefName`, and it does not start with `-`.
 *
 * @category models
 */
export const Name = Schema.String.check(Schema.makeFilter(isName, { title: "a git remote name" })).pipe(
  Schema.brand("@kalfa/git/RemoteName"),
);

export type Name = typeof Name.Type;

// A control character, a space or a backslash: the URL parser drops a tab, a line feed and a carriage return, so the text it reads is not the text git gets.
const HIDDEN = /[\p{Cc}\p{Zs}\\]/u;

const isWebOrFile = (text: string): boolean => {
  if (text.includes("?") || text.includes("#")) {
    return false;
  }

  if (!URL.canParse(text)) {
    return false;
  }

  const parsed = new URL(text);
  const authority = text.slice(text.indexOf("//") + 2).split("/")[0] ?? "";

  if (parsed.username !== "" || parsed.password !== "" || authority.includes("@")) {
    return false;
  }

  switch (parsed.protocol) {
    case "https:":
      return text.startsWith("https://") && parsed.hostname !== "";
    case "file:":
      return text.startsWith("file:///") && parsed.hostname === "";
    default:
      return false;
  }
};

// An absolute path, as git takes a local repository. A path that starts with two slashes names a host on some systems.
const isPath = (text: string): boolean => text.startsWith("/") && !text.startsWith("//");

const isUrl = (text: string): boolean => !HIDDEN.test(text) && (isPath(text) || isWebOrFile(text));

/**
 * Schema for a remote's URL as this package takes it: `https://host[:port]/path`, `file:///abs/path` or an absolute path.
 *
 * **Details**
 *
 * It holds no user, password, query or fragment and no space or control character. `http://`, `ssh://`, `git@host:path`, `ext::`, `fd::` and relative paths are refused.
 *
 * @category models
 */
export const Url = Schema.String.check(Schema.makeFilter(isUrl, { title: "a git remote URL" })).pipe(
  Schema.brand("@kalfa/git/RemoteUrl"),
);

export type Url = typeof Url.Type;

const Named = Schema.TaggedStruct("Named", { name: Name });

const ByUrl = Schema.TaggedStruct("Url", { url: Url });

/**
 * The remote a fetch reads from: a name this repository's config holds, or a URL.
 *
 * @category models
 */
export const Remote = Schema.Union([Named, ByUrl]);

export type Remote = typeof Remote.Type;

/**
 * The remote with this name in the config.
 *
 * @category constructors
 */
export const named = (name: Name): Remote => Named.make({ name });

/**
 * The remote at this URL, with no name.
 *
 * @category constructors
 */
export const url = (url: Url): Remote => ByUrl.make({ url });

/**
 * This repository has no remote of that name.
 *
 * @category errors
 */
export class NoSuchRemote extends Schema.TaggedError<NoSuchRemote, { readonly brand: unique symbol }>()(
  "NoSuchRemote",
  { remote: Name },
) {}

/**
 * A named remote's config holds no one URL this package takes.
 *
 * **Details**
 *
 * `reason` says why: `several` for more than one URL, `refused` for one that `Url` refuses. It never holds the configured text, which may hold a password.
 *
 * @category errors
 */
export class BadRemoteUrl extends Schema.TaggedError<BadRemoteUrl, { readonly brand: unique symbol }>()(
  "BadRemoteUrl",
  { remote: Name, reason: Schema.Literals(["several", "refused"]) },
) {}

/**
 * Git could not fetch from the URL: there is no repository there, no way to reach it, or a login was refused.
 *
 * **Details**
 *
 * `stderr` keeps at most `limits.bytes` of what git said.
 *
 * @category errors
 */
export class FetchFailed extends Schema.TaggedError<FetchFailed, { readonly brand: unique symbol }>()("FetchFailed", {
  url: Url,
  code: Schema.Int,
  stderr: Schema.String,
}) {}
