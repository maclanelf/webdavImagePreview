/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 启用 standalone 输出模式，用于 Docker 部署
  output: 'standalone',
  images: {
    domains: [],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

module.exports = nextConfig

