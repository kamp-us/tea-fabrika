# A pipe carries the writer's whole current value

A pipe's reader gets the writer's whole current value and the newest wins, so the right side of a pipe is a view of the left. A slow reader costs the writer one value in flight and one waiting, never a growing queue.
