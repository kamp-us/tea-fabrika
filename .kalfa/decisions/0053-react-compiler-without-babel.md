# Windows are React Compiler compatible from the first file, with no Babel

Every `next/` window follows the React Compiler's rules from its first `.tsx` file, because a window that breaks them freezes once compiled. The Compiler runs on oxc's native port, so there is no Babel in the build.
