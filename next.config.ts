import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "mupdf", "nspell", "dictionary-en", "dictionary-en-gb"],
  agentRules: false,
  // The PDF routes read the document font and the logo from the public folder on the server.
  outputFileTracingIncludes: { "/api/pdf/**/*": ["./public/fonts/**/*", "./public/logo.svg", "./public/logo.jpg"], "/parts/**/*": ["./node_modules/mupdf/dist/**/*"], "/api/spell/**/*": ["./node_modules/dictionary-en/index.*", "./node_modules/dictionary-en-gb/index.*"] },
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
