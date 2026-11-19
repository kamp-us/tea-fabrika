# A step that lacks a fact calls a helper, never another step

A step that needs a fact asks a small helper one question, and it answers `found` with the raw output or `cannot` with its reason, never pass or fail. Sending a reviewer back to the builder for a fact would start a loop between two agents. There are no shell allow-lists: typed reads become tools, and anything nobody foresaw goes to a helper.
