# tea is the one engine for state that moves

Every piece of state that moves is a tea machine, and what survives a sleep or a crash is its committed state, which boot installs without replaying anything. A Cmd is one bounded Effect whose answer comes back as a Msg. Effect's `Workflow`, replay engines and actor runtimes (cluster `Entity`, `Sharding`) are banned from holding our state, because a trial on `Workflow` gave us two durable models side by side; Effect stays as the engine under tea's Cmds.
