# A setting's value is plain data only

Configuration's protocol (https://github.com/kamp-us/tea-fabrika/issues/1749) says no setter reaches a caller, but
the review of `@kalfa/config`'s first build (https://github.com/kamp-us/tea-fabrika/pull/1922) found that a setting
whose value is a class instance (a `Date`, a `Map`, a `Duration`, a Schema class) cannot be frozen inside, and a
default of that kind was one object shared by every start, so one start's write reached the next. We decided that a
setting's value is plain data only: text, numbers, true or false, and lists and records of those, branded or not
(https://github.com/kamp-us/tea-fabrika/issues/1839#issuecomment-7087310445). Any other value type does not compile at
`Setting.make`, a cast that slips past the type is refused when the group is made, and each start hands out its own
deep-frozen copy. We chose this because it closes the whole kind of fault instead of writing it down as a known limit,
and because `Object.freeze` can hold plain data all the way down.

## Considered Options

- Copy and freeze what can be frozen, and write class values down as a known limit: rejected, because the fault came
  back from review more than once and a limit on paper does not stop the next one.
- Allow `null` too, as `Schema.Json` does: rejected, because no settings file or environment variable can write it,
  and `Schema.optionalKey` already says "a key that may be missing".
- A length of time as a number of milliseconds: rejected, because a person must then know the unit, and 15 minutes is
  `900000`.

## Consequences

- `null` and `undefined` are not plain data, so an optional part of a setting is `Schema.optionalKey`, never
  `Schema.optional`.
- A value type written as an `interface` (`Schema.Opaque` included) is refused, because the type cannot tell it from a
  class. A caller writes it as a `type`.
- A duration or a URL is declared as text, such as `"10 seconds"`, checked with `Schema.DurationFromString` or
  `Schema.URLFromString` when the file is read, and decoded with the same schema where the package reads it. About 30
  settings drafted for later packages take this form.
- Before this rule, a `Schema.Duration` setting took only Effect's JSON form in a settings file
  (`{ _tag = "Millis", value = 10000 }`), which no person should have to write, so text is the better form anyway.
- The rule's type was tried on the build's branch, not yet built: about 45 lines of types, and every existing law
  passed with one test schema moved from `Schema.optional` to `Schema.optionalKey`. A schema kind the trial did not
  try (`Schema.declare` with a hand-made type, a template literal) could still be judged wrong by the type; the check
  at group make catches the slip that matters.
