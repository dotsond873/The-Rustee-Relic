import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const env=process.env;
const repo='dotsond873/The-Rustee-Relic', branch='main';
const catalogPath='storefront/products.json';
const sessions=new Map(), attempts=new Map();
const configured=()=>env.ADMIN_EMAIL&&env.ADMIN_PASSWORD?.length>=16&&env.GITHUB_TOKEN;
const salt=randomBytes(32);
const passwordHash=scryptSync(env.ADMIN_PASSWORD||randomBytes(32).toString('hex'),salt,64);
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
class Failure extends Error {constructor(status,message){super(message);this.status=status;}}
async function github(path,method='GET',data){
 const r=await fetch(`https://api.github.com/repos/${repo}/${path}`,{method,headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(25000)});
 if(!r.ok){if(r.status===409||r.status===422)throw new Failure(409,'The catalog changed. Reload products before trying again.');throw new Failure(502,'Could not save or load from GitHub. Check the service token and try again.');}
 return r.json();
}
async function contents(path){return github(`contents/${path}?ref=${branch}`);}
function decode(file){return JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));}
async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>8*1024*1024)throw new Failure(413,'File too large. Choose a photo smaller than 5 MB.');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw new Failure(400,'Invalid request.');}}
export function validateProduct(input,previous){
 const p={...previous,...input};
 if(typeof p.title!=='string'||!p.title.trim()||p.title.length>500)throw new Failure(400,'Enter a title (up to 500 characters).');
 if(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<0||p.price>1000000)throw new Failure(400,'Enter a valid price.');
 if(!Number.isSafeInteger(p.quantity)||p.quantity<0||p.quantity>1000000)throw new Failure(400,'Enter a whole-number quantity.');
 if(typeof p.description!=='string'||p.description.length>50000)throw new Failure(400,'Description is too long.');
 if(typeof p.category!=='string'||!p.category.trim()||p.category.length>200)throw new Failure(400,'Choose a category.');
 if(!Array.isArray(p.images)||!p.images.length||p.images.length>20||p.images.some(x=>typeof x!=='string'||x.length>2000||!(/^https:\/\//.test(x)||/^\/assets\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(x))))throw new Failure(400,'Add 1–20 HTTPS photos or uploaded images.');
 return {...p,id:previous?.id||randomBytes(16).toString('hex'),sku:String(p.sku||'').slice(0,100),title:p.title.trim(),priceCents:Math.round(p.price*100),price:Math.round(p.price*100)/100,currency:'USD',tags:previous?.tags||[],variations:previous?.variations||[],collections:previous?.collections||[],pickupMentioned:Boolean(p.pickupMentioned)};
}
function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('rustee_session='))?.slice(15);const s=sessions.get(token);if(!s||s.expires<Date.now()){sessions.delete(token);throw new Failure(401,'Please sign in.');}return {token,...s};}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
export const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost');
 try{
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true});
  if(req.method==='GET'&&['/','/admin','/admin/','/admin.js','/admin.css'].includes(url.pathname)){
   const name=url.pathname.endsWith('.js')?'admin.js':url.pathname.endsWith('.css')?'admin.css':'index.html';
   res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(new URL(`./public/${name}`,import.meta.url)));
  }
  if(!url.pathname.startsWith('/api/'))throw new Failure(404,'Not found.');
  if(!configured())throw new Failure(503,'Admin setup is not complete. Configure ADMIN_EMAIL, ADMIN_PASSWORD (16+ characters), and GITHUB_TOKEN in Render.');
  if(req.method!=='GET'&&req.headers['sec-fetch-site']==='cross-site')throw new Failure(403,'Request blocked.');
  if(req.method==='POST'&&url.pathname==='/api/login'){
   // One service-wide budget prevents spoofed proxy headers from bypassing throttling.
   const key='login', now=Date.now();let a=attempts.get(key);if(!a||a.until<now){a={count:0,until:now+15*60*1000};attempts.set(key,a);}
   if(++a.count>20)throw new Failure(429,'Too many attempts. Wait 15 minutes before trying again.');
   const b=await body(req);if(typeof b.password!=='string'||b.password.length>1000||typeof b.email!=='string')throw new Failure(401,'Email or password is incorrect.');
   const hash=scryptSync(b.password,salt,64);
   if(!equal(hash,passwordHash)||!equal(b.email.trim().toLowerCase(),env.ADMIN_EMAIL.toLowerCase()))throw new Failure(401,'Email or password is incorrect.');
   const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
   sessions.set(token,{csrf,expires:now+8*60*60*1000});
   res.setHeader('Set-Cookie',`rustee_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);return send(res,200,{csrf});
  }
  const s=session(req);
  if(req.method!=='GET'&&!equal(req.headers['x-csrf-token']||'',s.csrf))throw new Failure(403,'Please reload and sign in again.');
  if(req.method==='GET'&&url.pathname==='/api/session')return send(res,200,{csrf:s.csrf,email:env.ADMIN_EMAIL});
  if(req.method==='POST'&&url.pathname==='/api/logout'){sessions.delete(s.token);res.setHeader('Set-Cookie','rustee_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/catalog'){
   const [file,cats]=await Promise.all([contents(catalogPath),contents('storefront/categories.json')]);return send(res,200,{products:decode(file),sha:file.sha,categories:decode(cats)});
  }
  if(req.method==='POST'&&url.pathname==='/api/product'){
   const b=await body(req),file=await contents(catalogPath);if(file.sha!==b.sha)throw new Failure(409,'Another change was published. Reload products first. Your edits are still on screen.');
   const list=decode(file),i=list.findIndex(p=>p.id===b.id);if(b.id&&i<0)throw new Failure(404,'Product no longer exists.');
   if(b.remove){if(i<0)throw new Failure(404,'Product no longer exists.');list.splice(i,1);}else{const p=validateProduct(b.product,i>=0?list[i]:undefined);if(i>=0)list[i]=p;else list.unshift(p);}
   const result=await github(`contents/${catalogPath}`,'PUT',{message:b.remove?'Remove product from admin':'Update catalog from admin',content:Buffer.from(JSON.stringify(list,null,2)+'\n').toString('base64'),sha:file.sha,branch});
   return send(res,200,{products:list,sha:result.content.sha});
  }
  if(req.method==='POST'&&url.pathname==='/api/upload'){
   const b=await body(req);if(typeof b.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))throw new Failure(400,'Invalid photo.');const bytes=Buffer.from(b.data,'base64');
   let ext;if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))ext='jpg';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';
   if(!ext||bytes.length>5*1024*1024)throw new Failure(400,'Choose a JPEG, PNG, or WebP photo smaller than 5 MB.');
   const path=`assets/uploads/${randomBytes(16).toString('hex')}.${ext}`;
   await github(`contents/storefront/${path}`,'PUT',{message:'Upload product photo from admin',content:bytes.toString('base64'),branch});return send(res,200,{url:`/${path}`});
  }
  throw new Failure(404,'Not found.');
 }catch(e){send(res,e.status||500,{error:e.status?e.message:'Something went wrong. Try again.'});}
});
setInterval(()=>{for(const [key,s]of sessions)if(s.expires<Date.now())sessions.delete(key);},60000).unref();
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(Number(env.PORT)||3000,'0.0.0.0');
