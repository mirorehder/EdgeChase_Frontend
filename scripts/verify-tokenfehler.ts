/**
 * Weist nach, dass ein abgelaufener Drive-Zugang als solcher erkannt wird -
 * und nicht als "invalid_grant" im Dashboard landet.
 *
 * Aus dem Betrieb: der Render lief durch, das Hochladen scheiterte, und im
 * Dashboard stand nur das eine Wort, das Google zurückgibt. Richtig, aber
 * ohne jeden Hinweis darauf, was zu tun ist. Und drei Render-Versuche liefen
 * durch, bevor aufgegeben wurde - jeder davon kostet Rechenzeit auf AWS,
 * obwohl schon vor dem ersten feststand, dass es scheitern würde.
 *
 * Braucht weder Datenbank noch Google: geprüft wird die Erkennung an den
 * Wortlauten, die Google und die googleapis-Bibliothek wirklich liefern.
 */
import { istTokenFehler, TOKEN_HINWEIS } from "../src/lib/drive";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`,
  );
}

console.log("1. Wortlaute, die einen toten Zugang bedeuten");
pruefe("blankes invalid_grant", istTokenFehler(new Error("invalid_grant")), true);
pruefe(
  "der Wortlaut aus dem Betrieb",
  istTokenFehler(new Error("invalid_grant")),
  true,
);
pruefe(
  "mit Beschreibung, wie googleapis ihn weiterreicht",
  istTokenFehler(new Error("invalid_grant: Token has been expired or revoked.")),
  true,
);
pruefe("abgelaufenes Zugangstoken", istTokenFehler(new Error("invalid_token")), true);
pruefe(
  "falscher OAuth-Client",
  istTokenFehler(new Error("unauthorized_client: Unauthorized")),
  true,
);
pruefe("auch als blosser Text", istTokenFehler("invalid_grant"), true);

console.log("\n2. Andere Fehler bleiben andere Fehler");
pruefe("das AWS-Kontingent", istTokenFehler(new Error("AWS Concurrency limit reached")), false);
pruefe("der Speicherfehler", istTokenFehler(new Error("Runtime.TruncatedResponse")), false);
pruefe("eine fehlende Datei", istTokenFehler(new Error("File not found: 1abc")), false);
pruefe(
  "ein Ordner ohne Freigabe",
  istTokenFehler(new Error("The user does not have sufficient permissions")),
  false,
);

console.log("\n3. Der Hinweis sagt, was zu tun ist");
pruefe("nennt die Ursache", TOKEN_HINWEIS.includes("invalid_grant"), true);
pruefe("nennt den Testmodus", TOKEN_HINWEIS.includes("Testmodus"), true);
pruefe("nennt das Skript", TOKEN_HINWEIS.includes("oauth-url.ts"), true);
pruefe("nennt die Variable", TOKEN_HINWEIS.includes("GOOGLE_OAUTH_REFRESH_TOKEN"), true);

console.log("\n4. Der eigene Hinweis wird selbst wiedererkannt");
// Wichtig, weil processJob den Fehler ein zweites Mal prueft, nachdem
// pruefeSchreibzugang ihn schon uebersetzt hat - sonst liefen doch wieder
// drei Render-Versuche.
pruefe("Hinweis gilt weiter als Tokenfehler", istTokenFehler(new Error(TOKEN_HINWEIS)), true);

console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
