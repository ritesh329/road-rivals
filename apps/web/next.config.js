/** @type {import('next').NextConfig} */
module.exports = {
  transpilePackages: ["@road-rivals/shared", "three"],
  async rewrites() {
    const api = process.env.API_URL || "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};
