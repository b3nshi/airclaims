import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Legal texts are read from disk at request time (signing hashes the exact text).
  outputFileTracingIncludes: { "/**": ["./content/legal/**/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never leak paths (and anything in them) to third parties.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin()(nextConfig);
