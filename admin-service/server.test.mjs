import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.ADMIN_EMAIL='owner@example.com';
process.env.ADMIN_PASSWORD='a-test-password-over-16-characters';
process.env.GITHUB_TOKEN='test-token';
const {server,validateProduct}=await import('./server.mjs');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(()=>server.close());
const base=`http://127.0.0.1:${server.address().port}`;
const realFetch=globalThis.fetch;
let catalog=[{id:'old',title:'Original',price:10,priceCents:1000,quantity:1,category:'Antiques',description:'Old find',images:['https://example.com/a.jpg'],source:{original:'preserved'},tags:[],variations:[]}],sha='original';
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://api.github.com/'))return realFetch(url,options);
 assert.equal(options.headers.Authorization,'Bearer test-token');
 if(options.method==='PUT'){
  const b=JSON.parse(options.body);
  if(String(url).includes('products.json')){assert.equal(b.sha,sha);catalog=JSON.parse(Buffer.from(b.content,'base64'));sha='updated';}
  return Response.json({content:{sha}});
 }
 if(String(url).includes('categories.json'))return Response.json({content:Buffer.from(JSON.stringify(['Antiques'])).toString('base64')});
 return Response.json({sha,content:Buffer.from(JSON.stringify(catalog)).toString('base64')});
};
let cookie,csrf;
async function request(path,data,auth=true,extra={}){return realFetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...extra},body:data?JSON.stringify(data):undefined});}
test('private catalog rejects anonymous access',async()=>{assert.equal((await request('/api/catalog',null,false)).status,401);});
test('incorrect password fails; successful login sets secure private cookie',async()=>{
 assert.equal((await request('/api/login',{email:'owner@example.com',password:'bad'},false)).status,401);
 const r=await request('/api/login',{email:'owner@example.com',password:process.env.ADMIN_PASSWORD},false);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;
});
test('catalog loads and does not disclose backend token',async()=>{const r=await request('/api/catalog');assert.equal(r.status,200);const j=await r.json();assert.equal(j.products.length,1);assert.ok(!JSON.stringify(j).includes('test-token'));});
test('CSRF and cross-site requests are blocked',async()=>{assert.equal((await request('/api/product',{},true,{'X-CSRF-Token':'bad'})).status,403);assert.equal((await request('/api/login',{},false,{'Sec-Fetch-Site':'cross-site'})).status,403);});
test('save preserves imported fields and normalizes price',async()=>{const r=await request('/api/product',{id:'old',sha,product:{...catalog[0],title:'Updated',price:12.34}});assert.equal(r.status,200);assert.equal(catalog[0].priceCents,1234);assert.equal(catalog[0].source.original,'preserved');});
test('stale catalog is rejected rather than overwritten',async()=>{assert.equal((await request('/api/product',{id:'old',sha:'stale',product:catalog[0]})).status,409);});
test('new products have storefront-compatible fields',()=>{const p=validateProduct({title:'New',price:2,quantity:1,category:'Antiques',description:'',images:['https://example.com/new.jpg']});assert.ok(p.id);assert.deepEqual(p.tags,[]);assert.deepEqual(p.variations,[]);assert.equal(p.currency,'USD');});
test('invalid quantities and unsafe photos fail validation',()=>{assert.throws(()=>validateProduct({...catalog[0],quantity:1.5}));assert.throws(()=>validateProduct({...catalog[0],images:['javascript:alert(1)']}));assert.throws(()=>validateProduct({...catalog[0],price:-1}));});
test('uploads reject SVG disguised as an image',async()=>{assert.equal((await request('/api/upload',{data:Buffer.from('<svg></svg>').toString('base64')})).status,400);});
test('logout invalidates the session',async()=>{assert.equal((await request('/api/logout',{})).status,200);assert.equal((await request('/api/catalog')).status,401);});
