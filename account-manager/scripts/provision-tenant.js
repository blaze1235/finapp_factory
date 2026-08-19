#!/usr/bin/env node
// Onboard a real agency. The owner login is created here and only here —
// there is no invite path that can mint another one.
//
//   node scripts/provision-tenant.js "Agency Name" CODE "Owner Name" +998901112233 1234
//
// Arguments are validated rather than trusted: `railway ssh -- <cmd>` re-joins
// its arguments through sh without preserving quotes, so a name with a space
// silently shifts every later argument. Failing loudly beats an owner whose
// phone number is the word "Owner".
const db = require('../db');

const [name, code, ownerName, ownerPhone, ownerPin] = process.argv.slice(2);
const die = m => { console.error(`✗ ${m}`); process.exit(1); };

if (!name || !code || !ownerName || !ownerPhone || !ownerPin)
  die('Usage: provision-tenant.js "Agency Name" CODE "Owner Name" +998901112233 1234');
if (!/^[A-Z][A-Z0-9]{1,9}$/.test(code)) die(`CODE must be 2–10 uppercase letters/digits, got "${code}"`);
if (!/^\+?\d{9,15}$/.test(ownerPhone.replace(/[ -]/g, '')))
  die(`Phone does not look like a phone number: "${ownerPhone}" — check the argument order and quoting`);
if (!/^\d{4,6}$/.test(ownerPin)) die(`PIN must be 4–6 digits, got "${ownerPin}"`);

(async () => {
  await db.init();
  const { tenant, ownerId } = await db.provisionTenant({ name, code, ownerName, ownerPhone, ownerPin });
  console.log(`✓ ${tenant.name} (${tenant.code}) — database ${tenant.db_name}, owner #${ownerId} ${ownerPhone}`);
  process.exit(0);
})().catch(e => die(e.message));
