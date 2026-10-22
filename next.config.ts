import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "p3000.smile-with-jesus.com",
    "p5173.smile-with-jesus.com",
  ],
};

export default nextConfig;
