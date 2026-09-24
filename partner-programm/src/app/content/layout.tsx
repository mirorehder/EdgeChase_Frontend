import type { ReactNode } from "react";
// Eigene Stile des Content-Generators (aus dem Promo-Generator übernommen).
// Nur für den /content-Bereich; die übrige Partner-App behält ihr Aussehen.
import "./content-gen.css";

export default function ContentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
