import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EdgeChase Promo-Video-Generator",
  description: "Kontroll-Oberfläche für den täglichen Promo-Video-Generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
