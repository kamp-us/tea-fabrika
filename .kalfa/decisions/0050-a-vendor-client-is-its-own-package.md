# A vendor's client is its own package, and translating stays in each domain's entry point

Code that several adapters for one vendor share, such as GitHub's API calls and its App login, lives in one package
named for the vendor: `@kalfa/github`. It is an Effect client in the vendor's own words (pull request, check run,
installation token) and implements no kalfa interface. Each domain still translates in its own entry point, such as
`@kalfa/codehost/github`, as decision 0048 says. This narrows 0048's rejected option: a provider package that holds
the adapters stays rejected; a client that holds none is allowed.

## Considered Options

- The login and client inside `@kalfa/codehost/github`, imported by the other domains' GitHub entry points: rejected,
  because Conversation and CI would then rank above Code hosting only to reach a client.
- A client that speaks our words (change request, check): rejected, because it would import every domain it serves
  while they import it, which is a cycle and the rejected provider package again.
- Each entry point brings its own client: rejected, because the login would be copied into each one.

## Consequences

`@kalfa/github` ranks above Secrets, whose signing key signs the App login, and below every domain that reaches
GitHub. Source control has no GitHub entry point: a GitHub remote is plain git with a credential. The installation
token becomes an access grant only inside `@kalfa/codehost/github`.
