import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function openDatabase(directory='data') {
 mkdirSync(directory,{recursive:true});
 const sql=new DatabaseSync(resolve(directory,'spm.sqlite'));
 sql.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
 if(!sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roster_setup'").get())sql.exec(readFileSync('drizzle/0000_roster.sql','utf8'));
 if(!sql.prepare("SELECT name FROM roster_setup WHERE name='initial-roster'").get()) {
  const seed=JSON.parse(readFileSync('worker/roster-seed.json','utf8'));
  sql.exec('BEGIN');
  try{for(const u of seed)sql.prepare('INSERT INTO roster_user(key,name,name_key,role,masked_id,sample,credential) VALUES(?,?,?,?,?,?,?)').run(u.key,u.name,u.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(),u.role,u.maskedId,Number(u.sample),u.match);
  sql.prepare('INSERT INTO roster_setup(name) VALUES(?)').run('initial-roster');sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
 }
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values)},first(){return sql.prepare(query).get(...args)||null},all(){return {results:sql.prepare(query).all(...args)}},run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}}});
 return {sql,db:{prepare:wrap,batch(stmts){sql.exec('BEGIN');try{const values=stmts.map(s=>s.run());sql.exec('COMMIT');return values}catch(e){sql.exec('ROLLBACK');throw e}}}};
}
