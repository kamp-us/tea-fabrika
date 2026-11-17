import { Schema } from "effect";

export const Search = Schema.Struct({
  query: Schema.String,
  at: Schema.Int,
  way: Schema.Literals(["back", "forward"]),
});

export type Search = typeof Search.Type;

/** History is newest first. An empty query has no match, as in bash's initial search. */
export const find = (history: ReadonlyArray<string>, query: string, from: number, way: "back" | "forward"): number => {
  if (query === "") {
    return -1;
  }

  for (let at = from; at >= 0 && at < history.length; at += way === "back" ? 1 : -1) {
    if (history[at]!.includes(query)) {
      return at;
    }
  }

  return -1;
};

export const shownSearch = (history: ReadonlyArray<string>, search: Search): string =>
  `(${search.at < 0 && search.query !== "" ? "failing " : ""}${search.way === "back" ? "reverse" : "forward"}-i-search)\`${search.query}': ${history[search.at] ?? ""}`;
