# Every record carries the build that wrote it

Every record a process writes carries its `build`, because which code made a record is the one fact that cannot be recovered later. Each load, refusal and failure of code is its own event, so every build has an earlier `code.loaded`.
