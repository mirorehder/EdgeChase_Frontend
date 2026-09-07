/**
 * Weist die Uhrzeiten-Betriebsart und die Umstellung auf Schweizer Zeit nach.
 *
 * Reine Logik, kein Netz. Prueft:
 *  1. Die Zeitzonen-Umrechnung fuer Europe/Zurich (auch ueber Sommer/Winter).
 *  2. Das Parsen der "HH:MM"-Eingaben.
 *  3. Die neue Fälligkeitslogik nach festen Uhrzeiten - inkl. Grenzfaellen.
 *  4. Dass die alte Fenster-Logik unveraendert greift, wenn keine Uhrzeiten
 *     gesetzt sind - jetzt aber in Schweizer Zeit.
 *
 * Braucht weder Datenbank noch Instagram: die Funktionen bekommen alle Werte
 * herein und werden gegen echte Grenzzeiten geprueft.
 */
import {
  chFormatUhrzeit,
  chGleicherTag,
  chMinutenImTag,
  chTagesBeginn,
  formatUhrzeit,
  parseUhrzeit,
} from "../src/lib/zeit";
import { istFaellig, parsePostingTimes, STANDARD_ZEITPLAN } from "../src/lib/postAuto";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

console.log("1. Zeitzonen-Umrechnung Europe/Zurich");

// 15. Juli 12:00 CEST = 10:00 UTC (Sommerzeit: UTC+2)
const sommerMittag = new Date("2026-07-15T10:00:00Z");
pruefe("Sommer: 12:00 CH", chFormatUhrzeit(sommerMittag), "12:00");
pruefe("Sommer: Minuten seit Mitternacht CH", chMinutenImTag(sommerMittag), 12 * 60);

// 15. Januar 12:00 CET = 11:00 UTC (Winterzeit: UTC+1)
const winterMittag = new Date("2026-01-15T11:00:00Z");
pruefe("Winter: 12:00 CH", chFormatUhrzeit(winterMittag), "12:00");
pruefe("Winter: Minuten seit Mitternacht CH", chMinutenImTag(winterMittag), 12 * 60);

// Sonderfall: 15. Januar 23:30 UTC = 00:30 CH des naechsten Tages (Winter, +1h)
const spaetAbends = new Date("2026-01-15T23:30:00Z");
pruefe("Winter: 15.01. 23:30 UTC = 00:30 CH (16.01.)", chFormatUhrzeit(spaetAbends), "00:30");

// chGleicherTag beachtet CH-Tag, nicht UTC-Tag.
// 15. Juli 22:30 UTC = 00:30 CH am 16. Juli
const gestern = new Date("2026-07-15T22:30:00Z");
const heute0130 = new Date("2026-07-16T01:30:00Z"); // = 03:30 CH am 16.07.
pruefe(
  "22:30 UTC (15.07.) und 01:30 UTC (16.07.) sind in CH derselbe Tag (16.07.)",
  chGleicherTag(gestern, heute0130),
  true,
);

// chTagesBeginn: 15. Juli 15:00 UTC = 17:00 CH → Tagesbeginn CH = 14. Juli 22:00 UTC? Nein,
// derselbe CH-Tag beginnt um 00:00 CH = 22:00 UTC am 14. Juli.
const nachmittagSommer = new Date("2026-07-15T15:00:00Z");
const tagesbeginn = chTagesBeginn(nachmittagSommer);
pruefe(
  "chTagesBeginn(15.07. 15:00 UTC) = 14.07. 22:00 UTC (= 00:00 CH am 15.07.)",
  tagesbeginn.toISOString(),
  "2026-07-14T22:00:00.000Z",
);

console.log("\n2. HH:MM-Parsen");
pruefe("17:00", parseUhrzeit("17:00"), 17 * 60);
pruefe("00:00", parseUhrzeit("00:00"), 0);
pruefe("23:59", parseUhrzeit("23:59"), 23 * 60 + 59);
pruefe("9:15 (einstellig)", parseUhrzeit("9:15"), 9 * 60 + 15);
pruefe("24:00 ist ungueltig", parseUhrzeit("24:00"), null);
pruefe("Unsinn ist ungueltig", parseUhrzeit("abc"), null);
pruefe("leer ist ungueltig", parseUhrzeit(""), null);

pruefe(
  "Liste einlesen mit Duplikat, sortiert",
  parsePostingTimes("20:00, 17:00 08:30 17:00"),
  [8 * 60 + 30, 17 * 60, 20 * 60],
);
pruefe("leere Liste", parsePostingTimes(""), []);
pruefe(
  "Formatieren zurueck",
  parsePostingTimes("20:00, 17:00").map(formatUhrzeit),
  ["17:00", "20:00"],
);

console.log("\n3. Faelligkeit nach festen Uhrzeiten (CH)");

// Ein Zeitplan im Uhrzeiten-Modus: Slots 17:00 CH und 20:00 CH.
const zeitplanUhrzeit = {
  ...STANDARD_ZEITPLAN,
  enabled: true,
  postingTimes: [17 * 60, 20 * 60],
};

// Vor allen Slots (heute 16:30 CH = 14:30 UTC im Sommer)
pruefe(
  "16:30 CH: noch nicht faellig, naechster Slot 17:00",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T14:30:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }),
  { faellig: false, grund: "naechster Slot 17:00 CH" },
);

// Genau 17:00 CH (= 15:00 UTC Sommer)
pruefe(
  "17:00 CH punkt: faellig",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T15:00:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }),
  { faellig: true },
);

// 17:30 CH: der 17:00-Slot ist noch offen, weil noch nichts gepostet wurde
pruefe(
  "17:30 CH ohne Post: 17:00-Slot noch offen",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T15:30:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }),
  { faellig: true },
);

// Nach dem 17:00-Post, um 17:30 CH: nicht mehr faellig
pruefe(
  "17:30 CH nach 17:15-Post: warten auf 20:00",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T15:30:00Z"),
    heuteGepostet: [new Date("2026-07-15T15:15:00Z")], // 17:15 CH
    hatKandidat: true,
  }),
  { faellig: false, grund: "naechster Slot 20:00 CH" },
);

// 20:00 CH nach dem 17:00-Post: faellig
pruefe(
  "20:00 CH: zweiter Slot greift",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T18:00:00Z"),
    heuteGepostet: [new Date("2026-07-15T15:15:00Z")],
    hatKandidat: true,
  }),
  { faellig: true },
);

// Alle Slots heute abgearbeitet
pruefe(
  "21:00 CH nach 17:00- und 20:00-Post: fertig fuer heute",
  istFaellig({
    zeitplan: zeitplanUhrzeit,
    jetzt: new Date("2026-07-15T19:00:00Z"),
    heuteGepostet: [
      new Date("2026-07-15T15:15:00Z"),
      new Date("2026-07-15T18:15:00Z"),
    ],
    hatKandidat: true,
  }),
  { faellig: false, grund: "keine offenen Slots mehr heute" },
);

// Uhrzeiten UEBERSCHREIBEN Fenster: Fenster-Werte werden ignoriert
const zeitplanBeides = {
  ...STANDARD_ZEITPLAN,
  enabled: true,
  postingTimes: [17 * 60],
  fensterVonMin: 22 * 60, // 22:00, waere spaeter
  fensterBisMin: 23 * 60,
  minAbstandMin: 999, // ein grosser Abstand, wird ignoriert
};
pruefe(
  "17:00 CH schlaegt widersprechendes Fenster",
  istFaellig({
    zeitplan: zeitplanBeides,
    jetzt: new Date("2026-07-15T15:00:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }),
  { faellig: true },
);

console.log("\n4. Fenster-Modus (leere postingTimes) - jetzt in CH-Zeit");

const zeitplanFenster = {
  ...STANDARD_ZEITPLAN,
  enabled: true,
  postingTimes: [],
  fensterVonMin: 8 * 60, // 08:00 CH
  fensterBisMin: 20 * 60, // 20:00 CH
  postsPerDay: 1,
  minAbstandMin: 120,
};

// 06:00 CH (04:00 UTC Sommer): vor dem Fenster
pruefe(
  "06:00 CH: vor dem Fenster",
  istFaellig({
    zeitplan: zeitplanFenster,
    jetzt: new Date("2026-07-15T04:00:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }).faellig,
  false,
);

// 12:00 CH: im Fenster, faellig
pruefe(
  "12:00 CH im Fenster: faellig",
  istFaellig({
    zeitplan: zeitplanFenster,
    jetzt: new Date("2026-07-15T10:00:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }).faellig,
  true,
);

// 22:00 CH: nach dem Fenster
pruefe(
  "22:00 CH: nach dem Fenster",
  istFaellig({
    zeitplan: zeitplanFenster,
    jetzt: new Date("2026-07-15T20:00:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  }).faellig,
  false,
);

// Tageslimit: schon ein Post heute (in CH gerechnet). Am gestrigen CH-Tag
// (der 14.07. 23:00 UTC ist noch 15.07. 01:00 CH? Nein - 14.07. 23:00 UTC ist
// 15.07. 01:00 CH). Also ein "gestern" in CH-Zeit ist z.B. 14.07. 21:00 UTC
// = 14.07. 23:00 CH.
pruefe(
  "gestern-Post zaehlt nicht auf heute (CH-Tag)",
  istFaellig({
    zeitplan: zeitplanFenster,
    jetzt: new Date("2026-07-15T10:00:00Z"), // 12:00 CH
    heuteGepostet: [new Date("2026-07-14T21:00:00Z")], // 14.07. 23:00 CH
    hatKandidat: true,
  }).faellig,
  true,
);

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
