# The new version grows beside today's

The new version is built in `next/` beside today's version, which keeps running until each job has moved, the strangler fig pattern. `next/` imports and copies nothing from today's code, and the pull request that switches a job over deletes the old part once its tests are ported. We chose this over replacing a whole layer in one pull request because the tracker is used every day and could not go dark.

## Consequences

A search finds both versions until the old one is gone, so every claim must say which version it is about. The risk is that the old version lives forever.
