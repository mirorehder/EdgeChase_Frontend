import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Die Oberfläche öffnet sich vom Home-Bildschirm wie eine App - dieselbe
 * Kombination aus Manifest, appleWebApp-Meta und apple-touch-icon wie beim
 * Coupon-Automaten, hier für das Partner-Dashboard.
 */
export const metadata: Metadata = {
  title: "EdgeChase Partner-Programm",
  description: "Kontroll-Oberfläche für den Partner-/Affiliate-Automaten",
  applicationName: "EdgeChase Partner",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "EdgeChase Partner",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
