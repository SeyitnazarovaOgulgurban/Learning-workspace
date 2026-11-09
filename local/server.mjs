import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const {openDatabase}=await import('./database.mjs');
const {default:worker}=await import('../dist/server/index.js');
const {db:DB}=openDatabase();
const port=Number(process.env.PORT||3000);
createServer(async(req,res)=>{try{
 const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>8192){res.writeHead(413);res.end('Request too large');return;}chunks.push(c);}
 const r=await worker.fetch(new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),{DB});
 res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
}catch(e){console.error(e.message);res.writeHead(500);res.end('Server error')}}).listen(port,'127.0.0.1',()=>console.log('SPM Studio: http://localhost:'+port+' (Ctrl+C to stop)'));
