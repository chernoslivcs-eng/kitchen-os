import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/Users/philip/Work/2026_AI_CREATIVE/KITCHEN_OS/.env','utf-8').split('\n')) { const m=/^([A-Z_]+)=(.*)$/.exec(line.trim()); if(m&&!process.env[m[1]!]) process.env[m[1]!]=m[2]!; }
const p = new Pool({connectionString: process.env.PG_URL});
const r = await p.query(`SELECT b.label, b.value, b.unit, b.state FROM pantry_batch b JOIN household h ON h.id=b.household_id JOIN "user" u ON u.household_id=h.id WHERE u.email='ux9@example.com' AND b.state != 'depleted' ORDER BY b.label`);
console.table(r.rows);
await p.end();
