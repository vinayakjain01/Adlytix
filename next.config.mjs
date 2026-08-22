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
  // Local dev only: lets `next dev`'s HMR/dev-resource requests through when
  // the app is opened via 127.0.0.1 instead of localhost (needed here since
  // Docker Desktop's WSL relay collides with "localhost" resolving to ::1 —
  // see the notes in backend/.env and .env.local). Has no effect on
  // `next build`'s static export.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}
export default nextConfig
