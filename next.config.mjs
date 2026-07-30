import { readFileSync } from 'node:fs'

// Stamped into every analytics event so an error spike can be attributed to a
// specific release rather than guessed at.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  output: 'export',
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
}
export default nextConfig
