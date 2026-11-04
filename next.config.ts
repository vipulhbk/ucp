import type { NextConfig } from "next";

// Protocol endpoints are request-time by nature (negotiation, idempotency, per-session state),
// so Cache Components (static-shell prerendering) is intentionally off.
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
