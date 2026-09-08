// ТІЛЬКИ читання. Що всередині matchVeto коштує: resolveLabel чи categoryOfWord.
import pg from 'pg';
import { PostgresRepo } from './postgres-repo.js';
import { resolveLabel, normalize } from '@kitchen/catalog';
import { categoryOfWord } from '../domain/veto-index.js';
const HH = 'f1ed1365-9f44-4c58-855f-4d1f883b4d21';
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 2 });
const repo = new PostgresRepo(pool);
const active = (await repo.listBatches(HH)).filter((b)=>b.state!=='depleted');
const labels = active.map((b)=>b.label);
console.log('партій:', labels.length);
console.log('приклади міток:', JSON.stringify(labels.slice(0,8), null, 0));

const words = (t: string) => normalize(t).split(/[^\p{L}\p{N}]+/u).filter((w)=>w.length>=3);

let t = performance.now();
for (const l of labels) { const ws = words(l); if (ws.length && ws.length <= 4) resolveLabel(l, 'generic'); }
console.log('\nresolveLabel по всіх мітках:', Math.round(performance.now()-t), 'мс');

t = performance.now();
for (const l of labels) for (const w of words(l)) categoryOfWord(w);
console.log('categoryOfWord по всіх словах:', Math.round(performance.now()-t), 'мс');

// Один виклик — скільки коштує
t = performance.now(); resolveLabel(labels[0]!, 'generic'); console.log('\nодин resolveLabel:', (performance.now()-t).toFixed(1), 'мс');
t = performance.now(); resolveLabel(labels[1]!, 'generic'); console.log('другий resolveLabel:', (performance.now()-t).toFixed(1), 'мс');
await pool.end();
