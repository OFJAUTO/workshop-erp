import { writeFileSync } from "node:fs";
import type { NextConfig } from "next";

// Every deploy has its own version: the page carries it, /version.json tells an open tab when a newer one is live.
// Local builds and the dev server say "local"/"dev", which never shows the new-version bar.
// APP_VERSION_OVERRIDE lets the browser test pretend to be a given version on the dev server.
const APP_VERSION = process.env.APP_VERSION_OVERRIDE || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || (process.env.NODE_ENV === "production" ? "local" : "dev");
if (process.env.NODE_ENV === "production") {
  try {
    writeFileSync("public/version.json", JSON.stringify({ version: APP_VERSION }));
  } catch {}
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
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
