// ТІЛЬКИ читання. Що саме всередині pantryItemView коштує 71 мс на партію.
import pg from 'pg';
import { PostgresRepo } from './postgres-repo.js';
import { pantryItemView, pantryVetoRows } from '@kitchen/domain';
import { BY_KEY } from '@kitchen/catalog/seed';
const HH = 'f1ed1365-9f44-4c58-855f-4d1f883b4d21';
const pool = new pg.Pool({ connectionString: process.env.URL_!, max: 2 });
const repo = new PostgresRepo(pool);
const UID = (await pool.query('SELECT user_id FROM household_member WHERE household_id=$1 AND role=$2 LIMIT 1',[HH,'owner'])).rows[0].user_id;
const all = await repo.listBatches(HH);
const active = all.filter((b)=>b.state!=='depleted');
const products = await repo.listProducts(HH);
const byId = new Map(products.map((p)=>[p.id,p]));
const veto = await repo.getVetoIndex(UID);
console.log('партій активних:', active.length, '| рядків вето:', veto.length, '| каталог BY_KEY:', BY_KEY.size);
console.log('рядки вето:', JSON.stringify(veto.map((v)=>({field:v.field, label:v.label, allergy:v.allergy})).slice(0,20), null, 1).slice(0, 900));

const now = Date.now();
// Ціле
let t = performance.now();
for (const b of active) pantryItemView(b, b.product_id ? byId.get(b.product_id) : undefined, veto, new Set(), now);
console.log('\npantryItemView усе:', Math.round(performance.now()-t), 'мс на', active.length, 'партій');

// Тільки вето
t = performance.now();
for (const b of active) pantryVetoRows(b, byId.get(b.product_id ?? '')?.catalog_key ?? null, veto);
console.log('лише pantryVetoRows:', Math.round(performance.now()-t), 'мс');

// Тільки каталог
t = performance.now();
for (const b of active) { const k = b.catalog_key ?? byId.get(b.product_id ?? '')?.catalog_key ?? null; if (k) BY_KEY.get(k); }
console.log('лише BY_KEY.get:', Math.round(performance.now()-t), 'мс');

// Вето з ПОРОЖНІМ індексом — щоб відділити вплив кількості рядків вето
t = performance.now();
for (const b of active) pantryVetoRows(b, byId.get(b.product_id ?? '')?.catalog_key ?? null, []);
console.log('pantryVetoRows з порожнім вето:', Math.round(performance.now()-t), 'мс');
await pool.end();
