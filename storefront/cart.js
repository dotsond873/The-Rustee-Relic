'use strict';
// Shopping cart and Stripe checkout. Loaded after app.js and uses its catalog (`products`, `active`, `money`, `esc`, `$`).
// The cart stays hidden until config.json names the checkout service, so the store works without it.
(()=>{
const KEY='rustee-cart', SHIPPING_FALLBACK=1250;
let api='', shippingCents=SHIPPING_FALLBACK, testMode=false, delivery='ship', busy=false;
let cart=new Map(); // product id -> quantity
try{const data=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(data))for(const [id,qty]of data)if(typeof id==='string'&&Number.isSafeInteger(qty)&&qty>0)cart.set(id,qty);}catch{}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify([...cart]));}catch{}};
const dollars=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const find=id=>products.find(p=>p.id===id);
const lines=()=>[...cart].map(([id,quantity])=>({product:find(id),quantity})).filter(l=>l.product);
const count=()=>lines().reduce((n,l)=>n+l.quantity,0);
const say=(text,error=false)=>{const el=$('#cart-status');el.textContent=text;el.classList.toggle('error',error);};

/** Drop anything sold or removed since the shopper last visited. Returns true if the cart changed. */
function prune(){
 if(!products.length)return false;
 let changed=false;
 for(const [id,qty]of cart){const p=find(id);const max=p?p.quantity:0;if(max<1){cart.delete(id);changed=true;}else if(qty>max){cart.set(id,max);changed=true;}}
 if(changed)persist();
 return changed;
}
function add(id){const p=find(id);if(!p||p.quantity<1)return;cart.set(id,Math.min((cart.get(id)||0)+1,p.quantity));persist();sync();}
function setQuantity(id,qty){const p=find(id);if(!p||qty<1)cart.delete(id);else cart.set(id,Math.min(qty,p.quantity));persist();sync();}

function sync(){
 if(!api)return;
 $('#cart-count').textContent=count();
 if(active){
  const button=$('#add-cart'), inCart=cart.get(active.id)||0;
  button.hidden=false;
  button.disabled=active.quantity<1;
  button.textContent=active.quantity<1?'Sold':inCart>=active.quantity?'In your cart — view cart':inCart?'Add another to cart':'Add to cart';
 }
 if($('#cart-dialog').open)renderCart();
}

function renderCart(){
 const list=lines(), pickupOnly=list.filter(l=>l.product.pickupMentioned);
 if(pickupOnly.length)delivery='pickup';
 $('#cart-empty').hidden=list.length>0;
 $('#cart-body').hidden=!list.length;
 $('#cart-test').hidden=!testMode;
 $('#cart-lines').innerHTML=list.map(({product:p,quantity})=>`<li class="cart-line"><img src="${esc(p.images[0]||'')}" alt="" loading="lazy"><div><p class="cart-line-title">${esc(p.title)}</p><p class="cart-line-price">${money(p)}${p.pickupMentioned?' · Local pickup only':''}</p>${p.quantity>1?`<div class="cart-qty"><button data-less="${esc(p.id)}" aria-label="Remove one ${esc(p.title)}">−</button><span aria-label="Quantity">${quantity}</span><button data-more="${esc(p.id)}" aria-label="Add one ${esc(p.title)}"${quantity>=p.quantity?' disabled':''}>+</button></div>`:''}</div><button class="text-button" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.title)} from cart">Remove</button></li>`).join('');
 const ship=$('#deliver-ship'), pickup=$('#deliver-pickup');
 ship.disabled=pickupOnly.length>0;ship.checked=delivery==='ship';pickup.checked=delivery==='pickup';
 $('#ship-price').textContent=dollars(shippingCents);
 $('#pickup-only-note').hidden=!pickupOnly.length;
 if(pickupOnly.length)$('#pickup-only-note').textContent=`${pickupOnly[0].product.title.slice(0,70)}${pickupOnly.length>1?` and ${pickupOnly.length-1} more`:''} can’t be shipped, so this order is local pickup in Decatur, Alabama.`;
 const subtotal=list.reduce((sum,l)=>sum+l.product.priceCents*l.quantity,0), shipping=delivery==='ship'?shippingCents:0;
 $('#cart-subtotal').textContent=dollars(subtotal);
 $('#cart-shipping-label').textContent=delivery==='ship'?'Flat-rate shipping':'Local pickup';
 $('#cart-shipping').textContent=shipping?dollars(shipping):'Free';
 $('#cart-total').textContent=dollars(subtotal+shipping);
 $('#cart-checkout').disabled=busy||!list.length;
}
function openCart(){prune();say('');if($('#product-dialog').open)$('#product-dialog').close();renderCart();if(!$('#cart-dialog').open)$('#cart-dialog').showModal();document.body.classList.add('modal-open');}

async function checkout(){
 const list=lines();if(busy||!list.length)return;
 busy=true;renderCart();say('Starting secure checkout… this can take up to a minute.');
 try{
  const r=await fetch(`${api}/checkout/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delivery,items:list.map(l=>({id:l.product.id,quantity:l.quantity}))}),signal:AbortSignal.timeout(90000)});
  const data=await r.json().catch(()=>({}));
  if(r.ok&&typeof data.url==='string'&&data.url.startsWith('https://checkout.stripe.com/')){location.assign(data.url);return;}
  if(Array.isArray(data.unavailable)){for(const u of data.unavailable){if(u.available>0)cart.set(u.id,u.available);else cart.delete(u.id);}persist();}
  say(data.error||'Checkout could not be started. Please try again.',true);
 }catch{say('Checkout could not be reached. Please try again in a moment, or contact us to buy.',true);}
 busy=false;sync();
}

function banner(text){const el=$('#checkout-banner');$('#checkout-banner-text').textContent=text;el.hidden=false;}
function returned(){
 const params=new URLSearchParams(location.search), result=params.get('checkout');
 if(!result)return;
 if(result==='success'){cart.clear();persist();banner('Thank you! Your order is confirmed and a receipt is on its way to your email. For local pickup, David will contact you to arrange a time.');}
 if(result==='cancelled')banner('Checkout was cancelled and you have not been charged. Your cart is saved.');
 params.delete('checkout');const rest=params.toString();
 history.replaceState(null,'',location.pathname+(rest?`?${rest}`:'')+location.hash);
}

async function start(){
 returned();
 try{const r=await fetch('config.json',{cache:'no-store'});if(r.ok){const c=await r.json();if(typeof c.checkoutApi==='string'&&(/^https:\/\/[^/]+/.test(c.checkoutApi)||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.checkoutApi)))api=c.checkoutApi.replace(/\/+$/,'');}}catch{}
 if(!api)return;
 // Asking for status also wakes the checkout service before the shopper needs it.
 try{const r=await fetch(`${api}/checkout/status`,{signal:AbortSignal.timeout(90000)});const s=await r.json();if(!r.ok||!s.enabled){api='';return;}testMode=Boolean(s.testMode);if(Number.isSafeInteger(s.shippingCents))shippingCents=s.shippingCents;}catch{api='';return;}
 document.body.classList.add('checkout-on');
 $('#cart-toggle').hidden=false;
 $('#shop-status').textContent='Secure checkout · Flat-rate U.S. shipping or free local pickup';
 $('#footer-checkout').textContent='Secure checkout by Stripe';
 $('#checkout-note').textContent='Secure checkout by Stripe. Sales tax is added at checkout.';
 $('#shipping-note').textContent=`${dollars(shippingCents)} flat rate per order`;
 prune();sync();
}

$('#cart-toggle').addEventListener('click',openCart);
$('#add-cart').addEventListener('click',()=>{if(!active)return;if((cart.get(active.id)||0)>=active.quantity)openCart();else add(active.id);});
$('#cart-close').addEventListener('click',()=>$('#cart-dialog').close());
$('#cart-continue').addEventListener('click',()=>$('#cart-dialog').close());
$('#cart-dialog').addEventListener('close',()=>{if(!$('#product-dialog').open)document.body.classList.remove('modal-open');});
$('#cart-lines').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.remove)setQuantity(b.dataset.remove,0);if(b.dataset.less)setQuantity(b.dataset.less,(cart.get(b.dataset.less)||0)-1);if(b.dataset.more)setQuantity(b.dataset.more,(cart.get(b.dataset.more)||0)+1);say('');});
document.querySelectorAll('input[name=delivery]').forEach(input=>input.addEventListener('change',()=>{delivery=input.value;renderCart();}));
$('#cart-checkout').addEventListener('click',checkout);
$('#checkout-banner-close').addEventListener('click',()=>{$('#checkout-banner').hidden=true;});
// app.js announces catalog loads, product views and saves through this event.
window.addEventListener('rustee:update',()=>{if(prune()&&$('#cart-dialog').open)say('Your cart was updated because an item is no longer available.',true);sync();});
// Returning from Stripe with the back button restores the page from cache; re-enable the button.
window.addEventListener('pageshow',e=>{if(e.persisted){busy=false;say('');sync();}});
start();
})();
