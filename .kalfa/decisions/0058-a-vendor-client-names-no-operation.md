# A vendor's client names no operation: each caller declares the ones it uses

`@kalfa/github` has three calls for all of GitHub: `call` runs one operation, `pages` reads a long list as a
`Stream`, and `watch` repeats a read and gives each changed answer. It has no `PullRequests.list` and knows no
area of GitHub. Each domain's `/github` entry point declares the operations it uses, as GitHub's own route text or
as an `effect/graphql` operation, with a Schema for only the fields it reads. We chose this because those entry
points are already the layer that turns GitHub's words into ours (decision 0050), so named calls in the client
would translate twice, and what is hard about GitHub (the App login, token refresh, rate-limit waits, retries,
paging, remembered answers) is the same for every operation and sits behind the three calls.

## Considered Options

- A named call per GitHub operation, grouped by area: rejected, because it is a second translating layer, it
  respells GitHub's names so GitHub's docs no longer match, and a field nobody declared needs a change to the
  client before a caller can read it.
- Every operation generated from GitHub's REST description and GraphQL schema: rejected, because a sketch showed
  the generator refusing GitHub's file until it was cleaned up, two bugs that showed only at run time, answers
  that fail to decode wherever GitHub's description is wrong, and 0.8 to 1.5 MB shipped to a browser caller.

## Consequences

A declaration is checked against GitHub's published API files by types that ship nothing, so a typo in a route,
a parameter or a field does not compile. Two callers that read the same thing each declare it. `effect/graphql`
is an experimental part of Effect and is named in the type checker's `allowedExperimentalApis` list; only this
package uses it. Identity is a fourth caller: `@kalfa/identity/github` runs the App's device flow (decision 0055).
