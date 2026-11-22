# A CI job shows the host's job token and learns one trace

The first step of a build runs `kalfa ci` on a runner to find which trace the build joins. It must read the build request in the app's Ledger, and a job has no client key (decision 0072). We decided that the job shows the code host's own short-lived job token (on GitHub, the OpenID Connect token of the workflow run) and gets exactly one answer: the trace of the build for the ref and commit that token names. The check is the host's, so it lives in `@kalfa/ci/github`. The job is no sender, gets no Ledger and writes nothing. We chose this because nothing long-lived then sits in the repository's settings to leak or rotate, and because the token only proves which ref and commit the job runs for, so that is all the job may ask about. The design ticket is https://github.com/kamp-us/tea-fabrika/issues/1862.

A sketch, not type-checked:

```ts
// @kalfa/ci/github
JobToken.check(token)
  // Effect<{ repo, ref, commit }, JobTokenRefused, JobTokenKeys>

// the one thing a job may ask
Ci.traceFor({ ref, commit })
  // Effect<TraceParent, NoSuchBuild, Ledger>
```

## Considered Options

- A read-only key kept as a repository secret: rejected, because it is a long-lived secret that no person's device holds and no person's key let in.
- A new sender kind for a job, acting for the person who allowed the workflow: rejected, because the workflow file comes from the pushed branch itself, so the token does not prove which code ran. A job is weaker than a signed-in client and gets less.
- The trace rides in the ref's name or the commit message, and the job reads nothing: rejected, because it answers this one lookup and gives no way to check who asks the next one.

## Consequences

- A test on a throwaway private repository, on 2026-11-21, showed that a job started by a pushed branch gets the token. Its claims name the repository, the ref and the commit, its workflow claim points at the workflow file on the pushed branch, and it ends five minutes after it is made.
- A pull request from an outside copy of the repository gets no token, so its build joins no trace.
- Each code host needs its own check. Only GitHub's is designed.
- A job cannot write through this. Its test spans reach the app as a build file the app fetches (decision 0079).
- Not decided: whether the token rides in the gateway's hello or in a plain web request.
