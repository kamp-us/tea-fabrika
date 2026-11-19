# The input that caused a write or a start signs it

The gateway stamps every input with its sender, and every write carries its direct cause (`parent`) in its data, never in the call stack, and is signed as that cause's sender; a trace id only explains, it never decides. A start is checked against the member whose input caused it, never the program that asked. A per-program grant list was rejected: the shell and the desk start everything, so they would need wildcards that check nothing.
