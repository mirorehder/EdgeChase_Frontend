/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stelle sicher, dass die statische ffmpeg-Binary (aus ffmpeg-static) mit ins
  // Serverless-Function-Bundle der /api/process-Route getract wird.
  outputFileTracingIncludes: {
    "/api/process": ["./node_modules/ffmpeg-static/**"],
  },
  // Native/Binary-Pakete nicht in den Bundler ziehen, sondern extern lassen.
  serverExternalPackages: ["ffmpeg-static"],
};

module.exports = nextConfig;
