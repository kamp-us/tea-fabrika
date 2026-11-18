// pnpm replaces source exports with publishConfig's compiled exports when packing.
const agent = process.env.npm_config_user_agent ?? "";

if (!agent.startsWith("pnpm/")) {
  process.stderr.write("@kalfa/config must be packed with pnpm so the archive exports dist/. Run pnpm pack.\n");
  process.exit(1);
}
