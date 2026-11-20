# A program's outside work is a Tool, quick or deferred

A step that acts on the outside world, such as posting a comment or starting a build, does it
through a `Tool` from `@kalfa/program`: `Tool.make(name, { parameters, success, error, execute })`,
yielded in the step as `yield* PostReply({ thread, text })`. The tool's answer, success or typed
error, is saved, so a step that runs again after a crash gets the saved answer instead of doing the
work twice, and `execute` gets a key as its second argument, so the outside side can spot a repeat.
`Tool.deferred` is the same with the answer coming later as a message the program lists among its
inputs, answered with `Tool.succeed` or `Tool.fail` and the token `execute` was given; until then
the hand-off is sent again on each wake. A hand-off failure listed in the tool's `error` is the
answer; any other failure is tried again; a defect leaves the step unconfirmed, as any step.

The shape follows Effect's: `Tool.make` mirrors `effect/ai`'s option names (with `error` for
`failure`, as `Activity` and `Rpc` say), `execute` sits inline as in `Activity.make`, and the
deferred answer mirrors `DurableDeferred.succeed`. Underneath it is tea's idempotent-effect piece,
`owed()` and `answerTo`.

## Considered Options

- Effect's `Activity` itself: rejected, because it needs a whole `WorkflowEngine` and its
  suspend-and-resume rules fight tea's own recovery.
- Effect's ai `Tool`: rejected for the core, because outside work is not always AI work. The
  `@kalfa/program/ai` entry point turns our Tool into Effect's, so an agent can be given the same
  definition.
- A handler given apart as a Layer (`toLayer`): rejected, because what a test fakes is already a
  service the tool requires.
- A slow call as "ask, end the step, the answer comes as a plain message": rejected, because a lost
  ask is never sent again, while a deferred tool's is.
- An `answers: "later"` flag on one constructor: rejected, because the constructor, not a flag,
  should decide what `yield*` returns.

## Consequences

A program's inputs stay plain schemas; a tool is never an input. Effect's own `HttpClient` takes
no key, so wrapping such a call in a tool is a rule we teach, not a type error; kalfa's own clients
take the key. Who may send a deferred tool's answer is checked when the message is saved
(Permissions and the ledger's admission), since a token alone does not prove the sender.
