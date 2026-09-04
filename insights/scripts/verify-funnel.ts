/**
 * Prueft den Promo-Funnel und die Code-Umsatz-Aggregation gegen erfundene
 * Bestellungen und Coupon-Codes.
 */
import { codeUmsatzKarte, funnelFuerVideo } from "../src/lib/funnel";
import type { WixBestellung } from "../src/lib/wix";

let fehler = 0;
function pruefe(name: string, bedingung: boolean, extra?: string) {
  if (bedingung) console.log(`  ok:   ${name}`);
  else {
    console.log(`  FAIL: ${name}${extra ? ` (${extra})` : ""}`);
    fehler += 1;
  }
}

function b(
  id: string,
  gesamt: number,
  bezahlt: boolean,
  codes: string[],
): WixBestellung {
  return {
    id,
    nummer: id,
    status: bezahlt ? "PAID" : "PENDING",
    bezahlt,
    gesamtBrutto: gesamt,
    waehrung: "EUR",
    erstellt: "2026-09-01T12:00:00Z",
    gutscheinCodes: codes,
    posten: [],
  };
}

console.log("codeUmsatzKarte: bezahlte Bestellungen, Code case-insensitiv");
{
  const bestellungen = [
    b("1", 100, true, ["MIRO10"]),
    b("2", 50, true, ["miro10"]),
    b("3", 200, false, ["MIRO10"]),
    b("4", 30, true, ["OTTO5", "MIRO10"]),
  ];
  const k = codeUmsatzKarte(bestellungen);
  pruefe("MIRO10 vorhanden", k.has("MIRO10"));
  const miro = k.get("MIRO10")!;
  pruefe(
    "MIRO10 dreimal eingeloest (nur bezahlt)",
    miro.eingeloest === 3,
    `war ${miro.eingeloest}`,
  );
  pruefe(
    "MIRO10 Umsatz 100+50+30",
    miro.umsatz === 180,
    `war ${miro.umsatz}`,
  );
  pruefe("OTTO5 vorhanden", k.has("OTTO5"));
  pruefe("OTTO5 Umsatz 30", k.get("OTTO5")!.umsatz === 30);
}

console.log("funnelFuerVideo: alle Quellen verbunden");
{
  const karte = codeUmsatzKarte([
    b("1", 100, true, ["A1"]),
    b("2", 40, true, ["B2"]),
  ]);
  const f = funnelFuerVideo({
    mediaId: "IG1",
    kommentare: 12,
    ausgegebeneCodes: ["A1", "B2", "C3"],
    codeUmsatz: karte,
    wixVerbunden: true,
  });
  pruefe("Kommentare 12", f.kommentare.wert === 12 && f.kommentare.messbar);
  pruefe("Codes 3", f.ausgegebeneCodes.wert === 3);
  pruefe(
    "Eingeloest 2 (A1 + B2, C3 nie eingeloest)",
    f.eingeloesteCodes.wert === 2,
    `war ${f.eingeloesteCodes.wert}`,
  );
  pruefe(
    "Umsatz 140",
    f.umsatz.wert === 140,
    `war ${f.umsatz.wert}`,
  );
}

console.log("funnelFuerVideo: Coupon-API fehlt");
{
  const f = funnelFuerVideo({
    mediaId: "IG1",
    kommentare: 5,
    ausgegebeneCodes: null,
    codeUmsatz: null,
    wixVerbunden: true,
  });
  pruefe("Kommentare messbar", f.kommentare.messbar);
  pruefe("Codes nicht messbar", !f.ausgegebeneCodes.messbar);
  pruefe("Umsatz nicht messbar", !f.umsatz.messbar);
  pruefe(
    "Umsatz-Hinweis nennt Coupon-API",
    (f.umsatz.hinweis ?? "").includes("Coupon"),
  );
}

console.log("funnelFuerVideo: Wix fehlt");
{
  const f = funnelFuerVideo({
    mediaId: "IG1",
    kommentare: 5,
    ausgegebeneCodes: ["A"],
    codeUmsatz: null,
    wixVerbunden: false,
  });
  pruefe("Codes messbar (aus Coupon-API)", f.ausgegebeneCodes.messbar);
  pruefe("Eingeloest nicht messbar", !f.eingeloesteCodes.messbar);
  pruefe(
    "Umsatz-Hinweis nennt Wix",
    (f.umsatz.hinweis ?? "").includes("Wix"),
  );
}

console.log("funnelFuerVideo: alle Quellen fehlen");
{
  const f = funnelFuerVideo({
    mediaId: "IG1",
    kommentare: null,
    ausgegebeneCodes: null,
    codeUmsatz: null,
    wixVerbunden: false,
  });
  pruefe("Nichts messbar",
    !f.kommentare.messbar &&
      !f.ausgegebeneCodes.messbar &&
      !f.eingeloesteCodes.messbar &&
      !f.umsatz.messbar);
}

process.exit(fehler > 0 ? 1 : 0);
