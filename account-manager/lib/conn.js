// Parses DATABASE_URL once into reusable connection parts, so we can open a Pool
// against a *different* database name on the same Postgres server (one server,
// many databases — "one house, separate rooms" per agency).
const pg = require('pg');

// A Postgres DATE is a calendar day, not an instant. node-pg turns it into a JS
// Date at local midnight, which then serialises to the *previous* day in UTC for
// anyone east of Greenwich — so a deliverable due 30 August reaches a client in
// Tashkent as 29 August. Hand dates back as the plain 'YYYY-MM-DD' they are.
pg.types.setTypeParser(1082, v => v);
const useSsl = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('rlwy.net');

function baseConfig() {
  const u = new URL(process.env.DATABASE_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
}

// The database name the control connection itself points at (used only to open
// an admin connection capable of running CREATE DATABASE).
function controlDbName() {
  return new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') || 'railway';
}

module.exports = { baseConfig, controlDbName };
