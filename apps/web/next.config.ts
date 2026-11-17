import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@jobfit/shared-types",
    "@jobfit/validators",
    "@jobfit/cv-parser",
    "@jobfit/job-extraction",
    "@jobfit/matching-engine",
    "@jobfit/eligibility-engine",
    "@jobfit/ai-service",
    "@jobfit/local-storage",
  ],
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
