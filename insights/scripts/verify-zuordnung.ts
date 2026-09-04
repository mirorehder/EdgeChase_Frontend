/**
 * Prueft die Sparte-Zuordnung gegen die echte Neon-DB.
 *
 * Live-Test - laeuft nur, wenn DATABASE_URL gesetzt ist. Ausgabe:
 *   - Anzahl geposteter Videos je Sparte
 *   - je Sparte die letzten 3 mit ihrer postedMediaId
 *
 * Erwartete Herzstuecke:
 *   - jede Sparte liefert Videos mit gefuellter postedMediaId
 *   - track-Werte gehoeren zur bekannten Liste (promo/viral/sports/clothing)
 */
import { anzahlJeSparte, letzteGepostet } from "../src/lib/mapping";
import { SPARTEN, TRACKS } from "../src/lib/tracks";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log(
      "DATABASE_URL nicht gesetzt - Live-Pruefung uebersprungen. Ok.",
    );
    return 0;
  }
  let fehler = 0;
  const zahlen = await anzahlJeSparte();
  console.log("Anzahl geposteter Videos je Sparte:");
  for (const s of SPARTEN) {
    console.log(`  ${s.kurz.padEnd(10)} ${zahlen[s.key]}`);
  }
  for (const s of SPARTEN) {
    const letzte = await letzteGepostet(s.key, 3);
    console.log(`\nSparte ${s.label} (${s.key}) - letzte ${letzte.length}:`);
    for (const v of letzte) {
      console.log(
        `  ${v.postedAt.toISOString().slice(0, 10)}  ${v.mediaId}  ${v.fileTitle ?? v.hookText}`,
      );
      if (!TRACKS.includes(v.track)) {
        console.log(`  FAIL: unbekannter track ${v.track}`);
        fehler += 1;
      }
      if (!v.mediaId) {
        console.log(`  FAIL: fehlende postedMediaId trotz Filter`);
        fehler += 1;
      }
    }
  }
  return fehler === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
