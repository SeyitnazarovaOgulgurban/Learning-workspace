import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function database() {
 const sql=new DatabaseSync(':memory:'); sql.exec(readFileSync('drizzle/0000_roster.sql','utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values)},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}});
 const db={prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const values=await Promise.all(stmts.map(s=>s.run()));sql.exec('COMMIT');return values}catch(e){sql.exec('ROLLBACK');throw e}}};
 sql.prepare('INSERT INTO roster_user(key,name,name_key,role,masked_id,credential) VALUES(?,?,?,?,?,?)').run('qa-admin','QA Administrator','qa administrator','admin','•••• 2026',createHash('sha256').update(JSON.stringify(['qa administrator','QA-ADMIN-2026'])).digest('hex'));
 return db;
}
