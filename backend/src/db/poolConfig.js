'use strict';

// Reine pg-Pool-Konfiguration aus ENV — eine Quelle, ohne Seiteneffekte (kein Pool,
// keine Verbindung) → unabhängig von einer laufenden DB testbar.
//
// Harte Grenzen, damit keine Query unbegrenzt blockiert und die Connection-Reserve
// kontrollierbar bleibt:
//   statement_timeout       — Postgres bricht eine zu lange Query SERVERSEITIG ab.
//   query_timeout           — node-postgres verwirft die Query CLIENTSEITIG (Fallback,
//                             falls selbst der Abbruch hängt). Bewusst >= statement_timeout.
//   connectionTimeoutMillis — Acquire blockiert nicht endlos; bei Pool-Sättigung schnelles Fail.
//   idleTimeoutMillis       — leerlaufende Verbindungen werden zurückgegeben.
function buildPoolConfig(env = process.env) {
  return {
    host:     env.DB_HOST     || 'localhost',
    port:     parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME     || 'soc_tickets_dev',
    user:     env.DB_USER     || 'soc_api',
    password: env.DB_PASSWORD || 'devpassword',
    max:      parseInt(env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis:       parseInt(env.DB_IDLE_TIMEOUT_MS       || '30000', 10),
    connectionTimeoutMillis: parseInt(env.DB_CONNECTION_TIMEOUT_MS || '3000',  10),
    statement_timeout:       parseInt(env.DB_STATEMENT_TIMEOUT_MS  || '15000', 10),
    query_timeout:           parseInt(env.DB_QUERY_TIMEOUT_MS      || '20000', 10),
    ssl: env.DB_SSL === 'true'
      ? { rejectUnauthorized: true }
      : false,
  };
}

module.exports = { buildPoolConfig };
