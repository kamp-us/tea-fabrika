# Leak guard

Checking text before it goes public, with a refusal that really stops the write.

## Language

**Public write**:
A write that someone outside the project can read: a push, with its code and commit messages; a pull request's title and description, and the squash message they become; a comment, an issue, a chat reply, a published page. Whether a place is public is a setting, one per place.
_Avoid_: publish, post, egress, upload

**Outgoing text**:
What one public write makes public for the first time. Text that is already public, such as a line only respaced or moved, is old text and is not outgoing. The guard reads the exact text that will be written, never an earlier draft of it. A push that sends only commits the remote already has makes no outgoing text, and it passes.
_Avoid_: diff, payload, content, input

**Rule**:
One thing the guard looks for in outgoing text, such as a private word, a home folder path, an API key or a link to a private page. Which rules run is a setting.
_Avoid_: pattern, shape, detector, check

**Private word**:
A word from the project's private word list, which must never go public. The list is a secret, kept in Secrets.
_Avoid_: banned word, blocklist, leak word

**Exception**:
A text the project allows to match a rule on purpose, such as the project's own repository address. Every exception is a setting; the guard has none built in.
_Avoid_: allowlist, ignore, skip, whitelist

**Verdict**:
The guard's answer for one public write: pass or refusal, and nothing else. Each verdict is kept on the ledger: where the write was going, the answer, and each finding's kind and place, never the text.
_Avoid_: status, result, warning, green, red

**Refusal**:
The verdict that stops the write. It names what kind of thing was found and where, never the matched text or the private word. Any check that could not finish is a refusal: outgoing text that could not be worked out, a missing word list, unreadable text, a timeout, or history too short to tell old text from new. Nothing skips a refusal; the text changes, or a rule or an exception changes as a setting.
_Avoid_: block, failure, error, hit, override
