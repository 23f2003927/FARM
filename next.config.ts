import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Retain dynamic routes in the client router cache for 30s to make tab switching instant
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
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
