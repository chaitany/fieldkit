/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fieldkit/core"],
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default nextConfig;
