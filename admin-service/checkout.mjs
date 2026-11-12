// Stripe Checkout for the public storefront.
// Prices, stock and pickup rules are always read from the catalog on the server;
// nothing the browser sends is trusted beyond product ids and quantities.
import {createHmac,timingSafeEqual} from 'node:crypto';

export const SHIPPING_CENTS=1250;
const MAX_LINES=20, MAX_QUANTITY=99, SESSION_MINUTES=31;
const catalogPath='storefront/products.json';

export class CheckoutError extends Error{
 constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}
}

/** Validate a cart against the catalog. `reserved(id)` is stock held by open checkouts. */
export function buildOrder(catalog,input,reserved=()=>0){
 const delivery=input?.delivery;
 if(delivery!=='ship'&&delivery!=='pickup')throw new CheckoutError(400,'Choose shipping or local pickup.');
 const items=input?.items;
 if(!Array.isArray(items)||!items.length)throw new CheckoutError(400,'Your cart is empty.');
 if(items.length>MAX_LINES)throw new CheckoutError(400,`Please check out with ${MAX_LINES} or fewer different items at a time.`);
 const seen=new Set(), lines=[], unavailable=[];
 for(const item of items){
  if(typeof item?.id!=='string'||!item.id||item.id.length>100||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>MAX_QUANTITY||seen.has(item.id))throw new CheckoutError(400,'Your cart could not be read. Please refresh the page and try again.');
  seen.add(item.id);
  const product=catalog.find(p=>p.id===item.id);
  const left=product?Math.max(0,product.quantity-reserved(product.id)):0;
  if(!product||!Number.isSafeInteger(product.priceCents)||product.priceCents<1||left<item.quantity){unavailable.push({id:item.id,available:left});continue;}
  lines.push({product,quantity:item.quantity});
 }
 if(unavailable.length)throw new CheckoutError(409,'Something in your cart was just sold or is on hold in another checkout. Your cart has been updated.',{unavailable});
 const pickupOnly=lines.filter(l=>l.product.pickupMentioned);
 if(delivery==='ship'&&pickupOnly.length)throw new CheckoutError(400,`${pickupOnly[0].product.title.slice(0,80)} is local pickup only. Choose local pickup to continue.`);
 const subtotal=lines.reduce((sum,l)=>sum+l.product.priceCents*l.quantity,0);
 if(subtotal<50)throw new CheckoutError(400,'Orders must total at least $0.50.');
 return {lines,delivery,subtotal};
}

/** Form-encoded body for POST /v1/checkout/sessions. */
export function sessionParams(order,{storeUrl,automaticTax=true,now=Date.now()}){
 const p=new URLSearchParams();
 p.set('mode','payment');
 p.set('success_url',`${storeUrl}/?checkout=success`);
 p.set('cancel_url',`${storeUrl}/?checkout=cancelled`);
 p.set('expires_at',String(Math.floor(now/1000)+SESSION_MINUTES*60));
 p.set('phone_number_collection[enabled]','true');
 if(automaticTax)p.set('automatic_tax[enabled]','true');
 order.lines.forEach(({product,quantity},i)=>{
  const k=`line_items[${i}]`;
  p.set(`${k}[quantity]`,String(quantity));
  p.set(`${k}[price_data][currency]`,'usd');
  p.set(`${k}[price_data][unit_amount]`,String(product.priceCents));
  if(automaticTax)p.set(`${k}[price_data][tax_behavior]`,'exclusive');
  p.set(`${k}[price_data][product_data][name]`,product.title.slice(0,200));
  p.set(`${k}[price_data][product_data][metadata][product_id]`,product.id);
  const image=product.images?.[0];
  if(image)p.set(`${k}[price_data][product_data][images][0]`,image.startsWith('/')?storeUrl+image:image);
 });
 const ship=order.delivery==='ship', rate='shipping_options[0][shipping_rate_data]';
 p.set(`${rate}[type]`,'fixed_amount');
 p.set(`${rate}[display_name]`,ship?'Flat-rate U.S. shipping':'Local pickup in Decatur, Alabama');
 p.set(`${rate}[fixed_amount][amount]`,String(ship?SHIPPING_CENTS:0));
 p.set(`${rate}[fixed_amount][currency]`,'usd');
 if(automaticTax)p.set(`${rate}[tax_behavior]`,'exclusive');
 if(ship)p.set('shipping_address_collection[allowed_countries][0]','US');
 else p.set('billing_address_collection','required');
 p.set('metadata[delivery]',order.delivery);
 // Metadata values are capped at 500 characters, so the item list is split across keys.
 const packed=JSON.stringify(order.lines.map(l=>[l.product.id,l.quantity]));
 for(let i=0;i*450<packed.length;i++)p.set(`metadata[items_${i}]`,packed.slice(i*450,(i+1)*450));
 return p;
}

export function itemsFromMetadata(metadata={}){
 let packed='';
 for(let i=0;typeof metadata[`items_${i}`]==='string';i++)packed+=metadata[`items_${i}`];
 try{const list=JSON.parse(packed);if(Array.isArray(list)&&list.every(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isSafeInteger(x[1])&&x[1]>0))return list;}catch{}
 return null;
}

/** Check a Stripe-Signature header against the raw request body. */
export function verifySignature(raw,header,secret,now=Date.now()){
 const parts=String(header||'').split(',').map(x=>x.trim().split('='));
 const t=parts.find(x=>x[0]==='t')?.[1];
 if(!t||!/^\d+$/.test(t)||Math.abs(now/1000-Number(t))>300)return false;
 const expected=Buffer.from(createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex'));
 return parts.some(([k,v])=>{if(k!=='v1'||!v)return false;const got=Buffer.from(v);return got.length===expected.length&&timingSafeEqual(got,expected);});
}

export function createCheckout({env,github,contents,decode,branch}){
 const holds=new Map(); // Stripe session id -> {items:[[id,qty]],expires}
 let budget={count:0,until:0};
 const storeUrl=()=>(env.STORE_URL||'https://therusteerelic.com').replace(/\/+$/,'');
 const origins=()=>(env.STORE_ORIGINS||'https://therusteerelic.com,https://www.therusteerelic.com').split(',').map(x=>x.trim()).filter(Boolean);
 const enabled=()=>Boolean(env.STRIPE_SECRET_KEY&&env.GITHUB_TOKEN);
 const reserved=id=>{let n=0;const now=Date.now();for(const [key,h]of holds){if(h.expires<now){holds.delete(key);continue;}for(const [pid,qty]of h.items)if(pid===id)n+=qty;}return n;};

 /** Sets CORS headers; returns false when a browser origin is not the storefront. */
 function cors(req,res){
  const origin=req.headers.origin;
  res.setHeader('Vary','Origin');
  if(!origin)return true;
  if(!origins().includes(origin))return false;
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','600');
  return true;
 }

 function status(){return {enabled:enabled(),testMode:!String(env.STRIPE_SECRET_KEY||'').startsWith('sk_live_'),shippingCents:SHIPPING_CENTS};}

 async function start(input){
  if(!enabled())throw new CheckoutError(503,'Online checkout is not open yet. Please contact us to buy this item.');
  const now=Date.now();
  if(budget.until<now)budget={count:0,until:now+10*60*1000};
  if(++budget.count>60)throw new CheckoutError(429,'Checkout is busy. Please try again in a few minutes.');
  const order=buildOrder(decode(await contents(catalogPath)),input,reserved);
  let r,data;
  try{
   r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body:sessionParams(order,{storeUrl:storeUrl(),automaticTax:env.STRIPE_AUTOMATIC_TAX!=='false',now}).toString(),signal:AbortSignal.timeout(25000)});
   data=await r.json();
  }catch{throw new CheckoutError(502,'Checkout could not be started. Please try again.');}
  if(!r.ok||typeof data?.url!=='string'){console.error('Stripe session failed:',r.status,data?.error?.type,data?.error?.code,data?.error?.message);throw new CheckoutError(502,'Checkout could not be started. Please try again or contact us.');}
  holds.set(data.id,{items:order.lines.map(l=>[l.product.id,l.quantity]),expires:now+SESSION_MINUTES*60*1000});
  return {url:data.url};
 }

 /** Reduce stock for a paid session. Safe to call more than once for the same session. */
 async function markSold(session){
  const items=itemsFromMetadata(session.metadata);
  if(!items)throw new Error('Paid session has no readable item list');
  for(let attempt=0;attempt<4;attempt++){
   const commits=await github(`commits?sha=${branch}&path=${catalogPath}&per_page=50`);
   if(Array.isArray(commits)&&commits.some(c=>String(c?.commit?.message||'').includes(session.id)))return 'already recorded';
   const file=await contents(catalogPath), list=decode(file);
   const oversold=[];
   for(const [id,qty]of items){const p=list.find(x=>x.id===id);if(!p||p.quantity<qty)oversold.push(id);if(p)p.quantity=Math.max(0,p.quantity-qty);}
   if(oversold.length)console.error(`Order ${session.id} sold more than the catalog had in stock:`,oversold.join(', '));
   try{
    await github(`contents/${catalogPath}`,'PUT',{message:`Mark sold from online order ${session.id}`,content:Buffer.from(JSON.stringify(list,null,2)+'\n').toString('base64'),sha:file.sha,branch});
    return 'recorded';
   }catch(e){if(e.status!==409||attempt===3)throw e;}
  }
 }

 async function webhook(raw,signature){
  if(!env.STRIPE_WEBHOOK_SECRET||!env.GITHUB_TOKEN)throw new CheckoutError(503,'Webhook is not configured.');
  if(!verifySignature(raw,signature,env.STRIPE_WEBHOOK_SECRET))throw new CheckoutError(400,'Invalid signature.');
  let event;try{event=JSON.parse(raw);}catch{throw new CheckoutError(400,'Invalid request.');}
  const session=event?.data?.object;
  if(event?.type==='checkout.session.expired'&&session?.id)holds.delete(session.id);
  const paid=event?.type==='checkout.session.async_payment_succeeded'||(event?.type==='checkout.session.completed'&&session?.payment_status!=='unpaid');
  if(paid&&session?.id){const result=await markSold(session);holds.delete(session.id);return {received:true,result};}
  return {received:true};
 }

 return {cors,status,start,webhook,reserved,holds};
}
