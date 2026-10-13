import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["playwright", "sharp"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
export default config;
