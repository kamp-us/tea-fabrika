# Kalfa is small Effect libraries, one domain each, each usable alone

Kalfa is a set of small Effect libraries, each covering one domain and each usable alone in any repo, whether or not it uses the rest. Some are protocols with adapters (the providers), and some are plain libraries, such as config. Each app is built by joining them at the top.

## Considered Options

- Kalfa as our own repo's tooling, reached through one command: rejected, because a package then grows our repo's rules into its code, and no other repo can use it.

## Consequences

A package belongs in kalfa only if another repo could use it as it is; whatever is specific to our repo is data the package reads from its edge. An app's own backend, its choice of programs, settings and Layers, is the app's, not kalfa's.
