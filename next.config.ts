import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "playwright",
    "playwright-extra",
    "puppeteer-extra-plugin-stealth",
    "@playwright/browser-chromium",
  ],
};

export default nextConfig;
