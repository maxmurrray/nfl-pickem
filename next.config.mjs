/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is used server-side to bake drop shadows into team logos for the
  // picks graphic (Satori ignores CSS filters). Keep it external so it isn't
  // bundled — it ships native binaries.
  serverExternalPackages: ["sharp"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }],
  },
};

export default nextConfig;
