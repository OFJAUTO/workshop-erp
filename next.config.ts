import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen depends on who is logged in, so pages are rendered per request.
  // The experimental component cache is left off on purpose.
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
