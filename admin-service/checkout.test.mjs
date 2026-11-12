import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
process.env.ADMIN_EMAIL='owner@example.com';
process.env.ADMIN_PASSWORD='a-test-password-over-16-characters';
process.env.GITHUB_TOKEN='test-token';
process.env.STRIPE_SECRET_KEY='sk_test_example';
process.env.STRIPE_WEBHOOK_SECRET='whsec_example';
const {server}=await import('./server.mjs');
const {buildOrder,sessionParams,itemsFromMetadata,verifySignature,SHIPPING_CENTS}=await import('./checkout.mjs');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(()=>server.close());
const base=`http://127.0.0.1:${server.address().port}`;
const realFetch=globalThis.fetch;
const product=(id,extra={})=>({id,title:`Find ${id}`,price:10,priceCents:1000,quantity:1,category:'Antiques',description:'',images:['https://example.com/a.jpg'],pickupMentioned:false,tags:[],variations:[],...extra});
let catalog,sha,commits,stripeCalls,stripeFails,sessionNumber=0;
function reset(){catalog=[product('reel'),product('jar',{priceCents:1599,quantity:3}),product('clock',{priceCents:45000,pickupMentioned:true}),product('gone',{quantity:0})];sha='sha-1';commits=[];stripeCalls=[];stripeFails=false;}
reset();
globalThis.fetch=async(url,options={})=>{
 url=String(url);
 if(url.startsWith('https://api.stripe.com/')){
  assert.equal(options.headers.Authorization,'Bearer sk_test_example');
  stripeCalls.push(new URLSearchParams(options.body));
  if(stripeFails)return Response.json({error:{type:'invalid_request_error',message:'nope'}},{status:400});
  return Response.json({id:`cs_test_${++sessionNumber}`,url:`https://checkout.stripe.com/c/pay/cs_test_${sessionNumber}`});
 }
 if(!url.startsWith('https://api.github.com/'))return realFetch(url,options);
 if(url.includes('/commits?'))return Response.json(commits.map(message=>({commit:{message}})));
 if(options.method==='PUT'){
  const b=JSON.parse(options.body);
  if(b.sha!==sha)return Response.json({},{status:409});
  catalog=JSON.parse(Buffer.from(b.content,'base64'));sha=`sha-${commits.length+2}`;commits.unshift(b.message);
  return Response.json({content:{sha}});
 }
 return Response.json({sha,content:Buffer.from(JSON.stringify(catalog)).toString('base64')});
};
const origin='https://therusteerelic.com';
const post=(path,data,headers={Origin:origin})=>realFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof data==='string'?data:JSON.stringify(data)});
function signed(event,secret='whsec_example',t=Math.floor(Date.now()/1000)){const raw=JSON.stringify(event);return {raw,header:`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`};}
const hook=(event,secret)=>{const {raw,header}=signed(event,secret);return post('/stripe/webhook',raw,{'Stripe-Signature':header});};
const paid=(id,items,type='checkout.session.completed')=>({type,data:{object:{id,payment_status:'paid',metadata:{delivery:'ship',items_0:JSON.stringify(items)}}}});

test('prices come from the catalog, never from the browser',()=>{
 const order=buildOrder(catalog,{delivery:'ship',items:[{id:'reel',quantity:1,priceCents:1,price:0.01},{id:'jar',quantity:2}]});
 assert.equal(order.subtotal,1000+2*1599);
 const p=sessionParams(order,{storeUrl:origin});
 assert.equal(p.get('line_items[0][price_data][unit_amount]'),'1000');
 assert.equal(p.get('line_items[1][price_data][unit_amount]'),'1599');
 assert.equal(p.get('line_items[1][quantity]'),'2');
});
test('shipping is a $12.50 flat rate to U.S. addresses with automatic tax',()=>{
 const p=sessionParams(buildOrder(catalog,{delivery:'ship',items:[{id:'reel',quantity:1}]}),{storeUrl:origin});
 assert.equal(SHIPPING_CENTS,1250);
 assert.equal(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'1250');
 assert.equal(p.get('shipping_address_collection[allowed_countries][0]'),'US');
 assert.equal(p.get('automatic_tax[enabled]'),'true');
 assert.equal(p.get('success_url'),`${origin}/?checkout=success`);
});
test('local pickup is free and asks for a billing address instead of shipping',()=>{
 const p=sessionParams(buildOrder(catalog,{delivery:'pickup',items:[{id:'clock',quantity:1}]}),{storeUrl:origin});
 assert.equal(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'0');
 assert.equal(p.get('shipping_address_collection[allowed_countries][0]'),null);
 assert.equal(p.get('billing_address_collection'),'required');
});
test('pickup-only items cannot be shipped',()=>{
 assert.throws(()=>buildOrder(catalog,{delivery:'ship',items:[{id:'reel',quantity:1},{id:'clock',quantity:1}]}),/local pickup only/);
});
test('sold-out, unknown and over-quantity items are reported back',()=>{
 for(const items of [[{id:'gone',quantity:1}],[{id:'missing',quantity:1}],[{id:'jar',quantity:4}]]){
  assert.throws(()=>buildOrder(catalog,{delivery:'ship',items}),e=>e.status===409&&e.extra.unavailable.length===1);
 }
});
test('malformed carts are rejected',()=>{
 for(const input of [null,{delivery:'ship'},{delivery:'ship',items:[]},{delivery:'drone',items:[{id:'reel',quantity:1}]},{delivery:'ship',items:[{id:'reel',quantity:0}]},{delivery:'ship',items:[{id:'reel',quantity:1.5}]},{delivery:'ship',items:[{id:'reel',quantity:-1}]},{delivery:'ship',items:[{id:'reel',quantity:1},{id:'reel',quantity:1}]},{delivery:'ship',items:Array.from({length:21},(_,i)=>({id:`x${i}`,quantity:1}))}]){
  assert.throws(()=>buildOrder(catalog,input),e=>e.status===400);
 }
});
test('long item lists survive the metadata size limit',()=>{
 const many=Array.from({length:20},(_,i)=>product(`${i}`.padStart(32,'a')));
 const order=buildOrder(many,{delivery:'ship',items:many.map(p=>({id:p.id,quantity:1}))});
 const p=sessionParams(order,{storeUrl:origin});
 const metadata={};for(const [k,v]of p){const m=k.match(/^metadata\[(.+)\]$/);if(m){assert.ok(v.length<=500);metadata[m[1]]=v;}}
 assert.deepEqual(itemsFromMetadata(metadata),many.map(p=>[p.id,1]));
});
test('webhook signatures: wrong secret, stale timestamp and tampering all fail',()=>{
 const {raw,header}=signed({a:1});
 assert.ok(verifySignature(raw,header,'whsec_example'));
 assert.ok(!verifySignature(raw,header,'whsec_other'));
 assert.ok(!verifySignature(raw+' ',header,'whsec_example'));
 assert.ok(!verifySignature(raw,signed({a:1},'whsec_example',Math.floor(Date.now()/1000)-3600).header,'whsec_example'));
 assert.ok(!verifySignature(raw,'','whsec_example'));
});

test('status reports test mode and allows only the storefront origin',async()=>{
 const r=await realFetch(base+'/checkout/status',{headers:{Origin:origin}});
 assert.deepEqual(await r.json(),{enabled:true,testMode:true,shippingCents:1250});
 assert.equal(r.headers.get('access-control-allow-origin'),origin);
 assert.equal((await post('/checkout/session',{delivery:'ship',items:[{id:'reel',quantity:1}]},{Origin:'https://evil.example'})).status,403);
 const preflight=await realFetch(base+'/checkout/session',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}});
 assert.equal(preflight.status,204);
});
test('starting checkout returns the Stripe URL and holds the item for other shoppers',async()=>{
 reset();
 const first=await post('/checkout/session',{delivery:'ship',items:[{id:'reel',quantity:1}]});
 assert.equal(first.status,200);assert.match((await first.json()).url,/^https:\/\/checkout\.stripe\.com\//);
 const second=await post('/checkout/session',{delivery:'ship',items:[{id:'reel',quantity:1}]});
 assert.equal(second.status,409);assert.deepEqual((await second.json()).unavailable,[{id:'reel',available:0}]);
 assert.equal(stripeCalls.length,1);
 // An expired session releases the hold.
 assert.equal((await hook({type:'checkout.session.expired',data:{object:{id:`cs_test_${sessionNumber}`}}})).status,200);
 assert.equal((await post('/checkout/session',{delivery:'ship',items:[{id:'reel',quantity:1}]})).status,200);
});
test('Stripe errors are not leaked to shoppers',async()=>{
 reset();stripeFails=true;
 const r=await post('/checkout/session',{delivery:'ship',items:[{id:'jar',quantity:1}]});
 assert.equal(r.status,502);const text=await r.text();assert.ok(!text.includes('nope')&&!text.includes('sk_test'));
});
test('a paid order marks stock sold exactly once, even if Stripe retries',async()=>{
 reset();
 const event=paid('cs_test_paid',[['reel',1],['jar',2]]);
 assert.equal((await hook(event)).status,200);
 assert.equal(catalog.find(p=>p.id==='reel').quantity,0);
 assert.equal(catalog.find(p=>p.id==='jar').quantity,1);
 assert.equal((await (await hook(event)).json()).result,'already recorded');
 assert.equal(catalog.find(p=>p.id==='jar').quantity,1);
 assert.equal(commits.length,1);
});
test('unpaid completions do not change stock; delayed payments do',async()=>{
 reset();
 const pending=paid('cs_test_wait',[['reel',1]]);pending.data.object.payment_status='unpaid';
 assert.equal((await hook(pending)).status,200);assert.equal(catalog.find(p=>p.id==='reel').quantity,1);
 assert.equal((await hook(paid('cs_test_wait',[['reel',1]],'checkout.session.async_payment_succeeded'))).status,200);
 assert.equal(catalog.find(p=>p.id==='reel').quantity,0);
});
test('forged webhooks are rejected and change nothing',async()=>{
 reset();
 assert.equal((await hook(paid('cs_test_forged',[['reel',1]]),'whsec_wrong')).status,400);
 assert.equal((await post('/stripe/webhook',JSON.stringify(paid('cs_test_forged',[['reel',1]])),{})).status,400);
 assert.equal(catalog.find(p=>p.id==='reel').quantity,1);
});
test('the admin API stays private',async()=>{
 assert.equal((await realFetch(base+'/api/catalog')).status,401);
});
