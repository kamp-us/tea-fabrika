// P12, next/. What `startDev`'s laws read from the calls their `fetch` stand-in answers. Each law
// sends through the entry's own client, `FetchHttpClient.layer`, and hands its stand-in to the
// client's `FetchHttpClient.Fetch` reference, so no law patches the global `fetch`.
import * as Predicate from "effect/Predicate";

/** A stand-in `fetch` call's body as text, sent as a string or as the client's bytes. */
export const bodyText = (options: RequestInit | undefined): string =>
  // SAFETY: the dev client sends a body as a string or as encoded bytes, and the string case is handled first.
  Predicate.isString(options?.body) ? options.body : new TextDecoder().decode(options?.body as Uint8Array);
