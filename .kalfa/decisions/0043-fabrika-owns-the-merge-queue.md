# fabrika owns the merge queue

Landing changes in order is fabrika's own job: one queue program holds the order, one small merger per change brings it up to date, waits for its checks on that exact head and merges pinned to it, and they talk by mail. The code host is only told what to merge, the queue never lands a tree it did not test, and it refuses a change whose kind names no check. We build our own because GitHub's merge queue cannot batch, skip an already tested tree, or follow our own rules, such as a freeze or docs-only paths.
