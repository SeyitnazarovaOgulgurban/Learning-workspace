import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const {openDatabase}=await import('./database.mjs');
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
 console.log('LOCAL COPY ONLY. This changes Olia’s local sign-in ID, not the hosted website.');
 const id=(await rl.question('Choose an ID (input is visible on your screen): ')).normalize('NFKC').trim().toUpperCase();
 if(!id||id.length>24||/[\p{C}]/u.test(id))throw Error('ID must contain 1–24 printable characters.');
 const {sql}=openDatabase();
 const user=sql.prepare("SELECT * FROM roster_user WHERE key='roster-1' AND role='admin'").get();
 if(!user)throw Error('Original administrator not found. No changes made.');
 const hash=createHash('sha256').update(JSON.stringify([user.name_key,id])).digest('hex');
 sql.prepare('UPDATE roster_user SET credential=?,masked_id=?,revision=revision+1 WHERE key=?').run(hash,'•••• '+id.slice(-4),user.key);
 console.log('Saved. Sign in locally with name: '+user.name);sql.close();
}finally{rl.close();}
