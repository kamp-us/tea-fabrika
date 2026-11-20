# Code quality

What a repo's tests are built from, and the checks that show its code and tests are good: test helpers, mutation
checks, lint rules and size limits.

## Language

**Tool**:
An outside program the package drives, such as a test runner, a mutation tool or a linter. Each tool is its own
part of the package.
_Avoid_: plugin, checker, integration

### Tests

**Law**:
A test that must hold. A plant must make it fail, which shows the law can fail at all. A law carries its own
plants.
_Avoid_: spec, assertion, case

**Label**:
What kind of law a law is: scenario, vector, pinned, format or type, or a property. A law names its label in how it
is declared, never in its title.
_Avoid_: prefix, tag, kind

**Depth**:
How far one test run goes: fast or full. A law over real input and output reads its number of cases from the depth,
never from a number of its own. The depth is a setting.
_Avoid_: mode, level, profile

**Recorder**:
A stand-in for a service that answers as the law wrote it and keeps each call made to it, in order, for the law to
read back. It keeps the calls, never the answers.
_Avoid_: spy, mock, fake

**Stub**:
A stand-in for a platform object, such as a storage bucket, that answers the members it was given and hands every
other member to one fallback.
_Avoid_: mock, fake, double

**Test database**:
A database file a test opens, either one the test owns and throws away, or one something else owns, which the test
only reads.
_Avoid_: fixture database, test DB

### Mutation checks

**Mutant**:
A copy of product code with one small break in it, made by a mutation tool. Stryker's word.
_Avoid_: mutation, fault, bug

**Plant**:
One mutant, picked by its shape in the code (the file, the kind of break, the original text and its replacement),
with the law that must kill it. It is written on that law.
_Avoid_: seeded bug, fault injection, mutant (for the pair)

**Catalog**:
A repo's plants, gathered from its laws. No file lists them. Each plant's name is unique in it; one plant gathered
from several test files is still one plant.
_Avoid_: registry, plant list, manifest, plant file

**Survey**:
A list of every mutant on some lines of a file, with what happened to each, used to find the shape of a new plant.
_Avoid_: scan, explore, dry run

**Answer**:
What one plant's run came to: killed, elsewhere, survived, no coverage, timeout or error. Only killed proves the law.
_Avoid_: verdict, result, status, outcome

**Killed**:
The law was among the tests that failed on the mutant.
_Avoid_: caught, passed

**Elsewhere**:
The mutant was killed, but not by the law.
_Avoid_: killed by another, wrong killer

**Survived**:
Every test still passed on the mutant.
_Avoid_: escaped, missed

**No coverage**:
No test ran the mutated code.
_Avoid_: uncovered, untested

**Host gate**:
The host's yes or no, asked right before a tool starts test files, on whether this machine may run them. A no stops
the run.
_Avoid_: guard, host check, safety check

### Lint

**Rule**:
One thing a lint looks for in a repo's files. A rule belongs here only if any repo could use it, or if what is
specific to one repo is a setting.
_Avoid_: check, lint (for one rule), plugin

**Banned characters**:
A rule that some characters must not appear in a file. Which characters, and the text allowed to hold them on
purpose, are settings; none is built in.
_Avoid_: em dash rule, character check

**Size limit**:
A rule that a file has at most a number of lines. Which files, and the number, are settings.
_Avoid_: map size, line cap, length check

**Diagnostic**:
What a rule reports about one place in the code. CLI's word.
_Avoid_: finding, violation, lint error, warning
