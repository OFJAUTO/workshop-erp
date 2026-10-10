import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  agentRules: false,
  // The PDF routes read the document font and the logo from the public folder on the server.
  outputFileTracingIncludes: { "/api/pdf/**/*": ["./public/fonts/**/*", "./public/logo.svg", "./public/logo.jpg"] },
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
