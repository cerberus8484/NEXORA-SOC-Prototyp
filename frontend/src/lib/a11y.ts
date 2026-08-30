import type { KeyboardEvent } from 'react';

// Barrierearmut-Helfer für nicht-native interaktive Elemente.
//
// Für echte Aktionen IMMER <button> bevorzugen. Wenn das Markup kein <button>
// sein kann (Tabellenzeile, Karte, Listeneintrag), schreibe role/tabIndex/onClick
// LITERAL ans Element (sonst sieht der jsx-a11y-Linter den Keyboard-Pfad nicht) und
// nutze onActivateKey für den Enter/Space-Handler — so bleibt nur die Tastenlogik DRY:
//
//   <div role="button" tabIndex={0} onClick={open} onKeyDown={onActivateKey(open)}>

export function onActivateKey(handler: () => void): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); // Space darf nicht scrollen, Enter nicht submitten
      handler();
    }
  };
}
