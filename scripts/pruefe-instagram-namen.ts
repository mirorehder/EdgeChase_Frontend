// Prüft die Erkennungslogik des Kommentar-Automaten gegen echte Kommentare
// und Bildunterschriften des EdgeChase-Kontos: npm run instagram:pruefe
//
// Die Logik entscheidet, wer einen Gutschein bekommt - sie ist der Teil, bei
// dem ein Fehler nach aussen sichtbar wird. Genau deshalb stehen hier auch
// die Fälle, an denen sie sich schon einmal verschluckt hat: "nice video"
// hätte beinahe einen Gutschein auf den Code "VIDEO" ausgelöst.
import {
  istAktionsReel,
  leseNameAusHandle,
  leseNameAusText,
  spracheAusCaption,
} from "@/lib/instagram/namen";

const namensFaelle: Array<[string, string | null]> = [
  ["Lars", "Lars"], ["Theo🔥", "Theo"], ["Cécile", "Cécile"], ["Lukas", "Lukas"],
  ["Siem", "Siem"], ["Alice🙌❤️", "Alice"], ["Luana❤️", "Luana"], ["Cyrill", "Cyrill"],
  ["Liam", "Liam"], ["Annesophie", "Annesophie"],
  ["🔥", null], ["✌️🥲", null],
  ["Yo, nothing showed up", null],
  ["@edgechase.official didn't get anything :(", null],
  ["Fr? Ruben", null],
  ["ok cool", null], ["nice video", null], ["gib mir bitte einen code", null],
];

const captionFaelle: Array<[string, boolean, "de" | "en"]> = [
  ["Drop your name and we'll send over the code! 😁\n\n#baselcity #summerdrop", true, "en"],
  ["Wir schicken dir einen Rabattcode mit deinem Namen drinnen! 😁\n\nedgechase.com", true, "de"],
  ["Drop your name in the comments and we'll send you a DM\n\n#baselcity", true, "en"],
  ["Kommentiere deinen Namen und wir schicken dir deinen Gutschein!", true, "de"],
  ["Palmflip Precision 🌴🩴\n\n#norisknofun #parkourlife", false, "en"],
  ["Stoked to announce @flips_by_lars_ as the first official EdgeChase athlete! Use the code „LARS15\" to get 15% off.", false, "en"],
  ["The last one luckily safed it 🥶\n\nGet 10% off by joining our WhatsApp channel.", false, "en"],
];

let fehler = 0;

for (const [eingabe, erwartet] of namensFaelle) {
  const ist = leseNameAusText(eingabe);
  const ok = ist === erwartet;
  if (!ok) fehler++;
  console.log(`${ok ? "OK  " : "FEHL"} Name  ${JSON.stringify(eingabe).padEnd(46)} -> ${String(ist).padEnd(12)} (erwartet ${erwartet})`);
}

for (const [caption, erwartetRelevant, erwarteteSprache] of captionFaelle) {
  const relevant = istAktionsReel(caption);
  const sprache = spracheAusCaption(caption);
  const ok = relevant === erwartetRelevant && (!erwartetRelevant || sprache === erwarteteSprache);
  if (!ok) fehler++;
  console.log(`${ok ? "OK  " : "FEHL"} Reel  relevant=${String(relevant).padEnd(5)} sprache=${sprache}  ${JSON.stringify(caption.slice(0, 52))}`);
}

for (const [handle, erwartet] of [["wespilk_mtb", "Wespilk"], ["lars.official", "Lars"], ["x_9_2", null], ["theo123", "Theo"]] as Array<[string, string | null]>) {
  const ist = leseNameAusHandle(handle);
  const ok = ist === erwartet;
  if (!ok) fehler++;
  console.log(`${ok ? "OK  " : "FEHL"} Handle ${handle.padEnd(20)} -> ${String(ist)} (erwartet ${erwartet})`);
}

console.log(fehler === 0 ? "\nAlle Fälle bestanden." : `\n${fehler} Fälle abweichend.`);
