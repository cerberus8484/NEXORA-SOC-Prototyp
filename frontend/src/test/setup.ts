import '@testing-library/jest-dom';
import i18n from '../i18n';

// Die Suite laeuft fest auf Deutsch.
//
// Grund: Diese Tests pruefen Verhalten -- welcher Ton zu welchem Status gehoert,
// welche Felder ein Dialog erklaert, wann eine Warnung erscheint. Der angezeigte
// Text ist dabei nur das Mittel, um das Verhalten zu greifen. Waere die Sprache
// frei, wuerde ein Wechsel der Standardsprache 164 Assertions brechen, ohne dass
// sich am Verhalten irgendetwas geaendert haette.
//
// Dass der englische Katalog vollstaendig und nicht leer ist, sichert
// i18n/catalogs.test.ts strukturell ab (gleiche Schluessel, gleiche Platzhalter)
// -- dafuer braucht es keine 164 doppelt gefuehrten Erwartungen.
void i18n.changeLanguage('de');
