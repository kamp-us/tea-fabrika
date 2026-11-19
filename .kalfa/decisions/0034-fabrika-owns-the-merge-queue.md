# fabrika owns the merge queue

Landing changes in order is fabrika's own job, and the code host is only told what to merge and when. One queue program holds the order, and one small merger per change brings it up to date, waits for its checks on that exact head and merges pinned to it; they talk by program mail, never Cloudflare Workflows, so every wait is a named state. A conflict or a red check goes back with its reason, an outside fault is retried, and the queue never loosens what a merge needs.
