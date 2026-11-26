import type { ViralesLied } from "./soundQuelle";

/**
 * Die feste Liste guter Lieder - von Hand ausgewaehlt, fuer alle Generatoren
 * (EdgeChase und Doc Meiro). Zu jedem Lied sucht die App taeglich die
 * zugeschnittenen Original-Sounds im Instagram-Katalog; Gemini bewertet sie.
 *
 * "titel" ist der reine Liedtitel (ohne "slowed", "sped-up", "feat." usw.),
 * "kuenstler" hilft, bei kurzen Titeln Zufallstreffer auszusortieren.
 *
 * Neue Lieder einfach unten ergaenzen.
 */
export const FESTE_LIEDER: ViralesLied[] = [
  // Aus der eigenen Instagram-Audio-Liste (dunkler Phonk, Trap, Drill, slowed/sped-up).
  { titel: "Portofino", kuenstler: "Malditho.wav" },
  { titel: "Legacy", kuenstler: "backfromparadise" },
  { titel: "two faced", kuenstler: "purc" },
  { titel: "crypt", kuenstler: "bbygirl" },
  { titel: "Almond", kuenstler: "Adanthewizard" },
  { titel: "On Your Own", kuenstler: "Lil Tecca" },
  { titel: "Conquer", kuenstler: "Prod.synergy" },
  { titel: "Make A Move", kuenstler: "RAIIN" },
  { titel: "Roncona", kuenstler: "Nobdy" },
  { titel: "Everything In Its Right Place", kuenstler: "jewels" },
  { titel: "I dont wanna play around", kuenstler: "Prod. Carter" },
  { titel: "Divine", kuenstler: "MPM Beats" },
  { titel: "Aces", kuenstler: "dkj" },
  { titel: "Fast FWD", kuenstler: "Port London" },
  { titel: "Without a Warning", kuenstler: "The Weeknd" },
  { titel: "Dreams Come True", kuenstler: "excape" },
  { titel: "Raging Wolf", kuenstler: "ASCEND" },
  { titel: "Igor's Theme", kuenstler: "Tyler, The Creator" },
  { titel: "Hallucinations", kuenstler: "BACCO" },
  // Die beiden ersten Favoriten aus dem Katalog.
  { titel: "Lala Miyagi", kuenstler: "Chief Keef" },
  { titel: "Drop It Like It's Hot", kuenstler: "Snoop Dogg" },
];
