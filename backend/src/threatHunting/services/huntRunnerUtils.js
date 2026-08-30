'use strict';

/**
 * Vergleicht zwei Severity/Risk-Werte und gibt den höheren zurück.
 * Reine Funktion — kein Zustand, kein I/O.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function maxRisk(a, b) {
  const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return (order[b] ?? 0) > (order[a] ?? 0) ? b : a;
}

/**
 * Wartet `ms` Millisekunden (für asynchrone Runner-Steps).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { maxRisk, sleep };
