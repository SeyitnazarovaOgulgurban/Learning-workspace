import {createServer} from 'node:http';
import worker from '../dist/server/index.js';
import {database} from './runtime.mjs';
const DB=database();
createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const r=await worker.fetch(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),{DB});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){console.error(e);res.writeHead(500);res.end('Error')}}).listen(Number(process.env.PORT || 3000),'0.0.0.0');
