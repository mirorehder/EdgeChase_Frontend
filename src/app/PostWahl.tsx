"use client";

/**
 * Die Wahl bei Handversuchen: das Video nach dem Erstellen gleich posten oder
 * nur erstellen.
 *
 * Der Tageslauf folgt dem Schalter der Sparte ("Posten nach dem Erstellen").
 * Ein Handversuch dagegen ist meist ein Versuch - deshalb entscheidet der
 * Nutzer jedes Mal selbst, und ohne Haken wird nur erstellt.
 */
export function PostWahl({
  wert,
  setzen,
  disabled,
}: {
  wert: boolean;
  setzen: (neu: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox" title="Aus: das Video wird nur erstellt, gepostet wird später von Hand.">
      <input
        type="checkbox"
        checked={wert}
        disabled={disabled}
        onChange={(e) => setzen(e.target.checked)}
      />
      <span>Direkt nach dem Erstellen posten</span>
    </label>
  );
}
