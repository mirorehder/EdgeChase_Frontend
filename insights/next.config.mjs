/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Instagram-Vorschaubilder werden direkt vom CDN geladen; wir behandeln sie
  // als externe Bilder ueber ein simples <img>, deshalb keine next/image-Domain
  // hier - so ist die App unabhaengig davon, welche CDN-Hostnamen Instagram
  // gerade ausliefert.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
