import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // This repo's CLAUDE.md is the canonical agent doc (team charter, roles,
  // skills) — don't let `next dev`/`next build` auto-append their generated
  // "agent rules" block into it (or write a separate AGENTS.md) on every run.
  agentRules: false,
};

export default nextConfig;
