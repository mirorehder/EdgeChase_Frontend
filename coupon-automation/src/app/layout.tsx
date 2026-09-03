import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Die Oberfläche soll sich vom Home-Bildschirm aus wie eine App öffnen, nicht
 * wie ein Lesezeichen. Dafür braucht es dreierlei, und alle drei Teile müssen
 * zusammenpassen:
 *
 * - public/manifest.json mit "display": "standalone" - danach richtet sich
 *   Android.
 * - appleWebApp.capable - iOS hat das Manifest lange ignoriert und hört auch
 *   heute noch zuverlässiger auf dieses Meta-Tag.
 * - public/apple-touch-icon.png - iOS nimmt die Icons aus dem Manifest nicht.
 *   Fehlt die Datei, macht es einen Screenshot der Seite zum Icon.
 */
export const metadata: Metadata = {
  title: "EdgeChase Coupon-Automat",
  description: "Kontroll-Oberfläche für den Instagram-Kommentar-Automaten",
  applicationName: "EdgeChase Coupons",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    // Nicht "default": das wäre auf iOS ein weisser Streifen über einer sonst
    // durchgehend dunklen Oberfläche.
    statusBarStyle: "black",
    title: "EdgeChase Coupons",
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
  // Ohne "cover" bleibt env(safe-area-inset-*) auf null, und der untere
  // Rand klebt am Home-Indikator.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
