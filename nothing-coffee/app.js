(() => {
'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
// All authenticated API traffic goes through this storefront's Nginx /api proxy.
const API='';
let catalog=[],visible=[],category='All',searchText='',user=null,cart={},cartBusy=false,retailerStatus='NOT_APPLIED',retailerDiscount=0,searchRequestSeq=0,searchDebounce,wishlistIds=new Set();
const productById=id=>catalog.find(p=>String(p.productId)===String(id));
const itemPrice=p=>retailerStatus==='APPROVED'?Math.round((p.price*(100-retailerDiscount)/100)*100)/100:p.price;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={'Electronics':'🎧','Fashion':'👟','Home & Living':'💡','Grocery':'🛒','Beauty':'🧴','Coffee':'☕'};
const productCategories=[
 {name:'Electronics',icon:'🎧',sub:'Gadgets & tech'},
 {name:'Fashion',icon:'👕',sub:'Everyday style'},
 {name:'Home & Living',icon:'🛋️',sub:'Make it yours'},
 {name:'Grocery',icon:'🛒',sub:'Daily essentials'},
 {name:'Beauty',icon:'🧴',sub:'Care & wellness'}
];
const tones={'Electronics':'#e8eefa','Fashion':'#ffede8','Home & Living':'#f2eddc','Grocery':'#ecf6db','Beauty':'#ffecf2','Coffee':'#f5e9d8'};
// A recognisable, product-specific illustration is preferable to an unrelated stock photo.
const productIcons=[
 [/earbuds/i,'🎧'],[/headphones/i,'🎧'],[/speaker/i,'🔊'],[/charger/i,'🔌'],[/power bank/i,'🔋'],[/keyboard/i,'⌨️'],[/laptop stand/i,'💻'],[/webcam/i,'📷'],[/usb-c multiport/i,'🔗'],[/charging pad/i,'⚡'],[/ssd/i,'💾'],[/watch/i,'⌚'],
 [/water bottle/i,'🧴'],[/bedsheet/i,'🛏️'],[/desk lamp/i,'💡'],[/mug/i,'☕'],[/frying pan/i,'🍳'],[/diffuser/i,'🪔'],[/cushion/i,'🛋️'],[/storage box/i,'🗃️'],[/kitchen scale/i,'⚖️'],
 [/backpack/i,'🎒'],[/t-shirt/i,'👕'],[/running shoes/i,'👟'],[/hoodie/i,'🧥'],[/wallet/i,'👛'],[/sunglasses/i,'🕶️'],[/duffel/i,'🧳'],[/socks/i,'🧦'],[/denim jacket/i,'👖'],
 [/rice/i,'🍚'],[/almonds/i,'🥜'],[/green tea/i,'🍵'],[/groundnut oil/i,'🫗'],[/peanut butter/i,'🥜'],[/oats/i,'🥣'],[/coffee beans/i,'🫘'],[/chocolate/i,'🍫'],
 [/sunscreen/i,'☀️'],[/face wash/i,'🫧'],[/vitamin c serum/i,'💧'],[/moisturizer/i,'🧴'],[/shampoo/i,'🧼'],[/lip balm/i,'💄'],[/hand cream/i,'🖐️'],[/body lotion/i,'🧴']
];
const chooseIcon=p=>productIcons.find(([pattern])=>pattern.test(p.name))?.[1]||icons[p.category]||'📦';
const productArtwork=p=>{
 const palette=['#e9edff','#feede5','#f2eeda','#dff3ed','#ffe7ee','#e9e4fa','#e9f2ff','#f1ecd8'];
 const hash=Array.from(p.name).reduce((x,c)=>(x*31+c.charCodeAt(0))>>>0,7);
 const bg=palette[hash%palette.length];
 return '<div class="product-placeholder" style="--photo-bg:'+bg+'"><span class="product-placeholder-icon" aria-hidden="true">'+chooseIcon(p)+'</span><span class="product-placeholder-name">'+escape(p.name)+'</span><span class="product-placeholder-label">PRODUCT ILLUSTRATION</span></div>';
};
const bindImageFallbacks=scope=>{
 scope.querySelectorAll('img[data-product-image]').forEach(img=>{
  img.addEventListener('error',()=>{
   const p=productById(img.dataset.productImage);
   if(p)img.replaceWith(document.createRange().createContextualFragment(productArtwork(p)));
  },{once:true});
 });
};

const notify=(msg,bad=false)=>{const el=$('toast');el.textContent=msg;el.style.background=bad?'#8b2424':'#172339';el.classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('visible'),4500)};
async function request(path,options={}){
 const r=await fetch(API+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
 if(!r.ok)throw new Error((data&&typeof data==='object'&&(data.message||data.error))||('HTTP '+r.status));
 return data;
}
function saveGuest(){localStorage.setItem('nothing-guest-cart',JSON.stringify(cart))}
function readGuest(){try{return JSON.parse(localStorage.getItem('nothing-guest-cart')||'{}')||{}}catch{return {}}}
function updateCart(){
 const items=Object.entries(cart).filter(([id,q])=>Number(q)>0&&productById(id));
 const count=items.reduce((n,[id,q])=>n+Number(q),0);
 $('cartCount').textContent=count;
 $('bottomCartCount').textContent=count;
 $('bottomCartCount').hidden=count===0;
 $('cartTotal').textContent=money(items.reduce((n,[id,q])=>n+itemPrice(productById(id))*q,0));
 $('cartItems').innerHTML=items.length?items.map(([id,q])=>{
   const p=productById(id);const thumb=p.image&&/^https:\/\//.test(p.image)?'<img data-product-image="'+escape(id)+'" loading="lazy" src="'+escape(p.image)+'" alt="'+escape(p.name)+'">':chooseIcon(p);return '<div class="cart-row"><div class="cart-icon">'+thumb+'</div><div><strong>'+escape(p.name)+'</strong><small>'+escape(p.category)+' · '+escape(p.city||'India')+'</small><div class="qty"><button type="button" data-qty="'+id+'" data-delta="-1" aria-label="Decrease quantity">−</button><b>'+q+'</b><button type="button" data-qty="'+id+'" data-delta="1" aria-label="Increase quantity">+</button></div></div><div class="cart-price">'+money(itemPrice(p)*q)+'</div></div>';
 }).join(''):'<div class="empty-state"><strong>YOUR BAG IS EMPTY.</strong><p>Some good stuff is waiting for you.</p></div>';
 $('cartSyncStatus').textContent=user?'Saved to your PostgreSQL cart':'Guest bag saved on this device';
 $('checkoutBtn').disabled=!count||cartBusy;
 bindImageFallbacks($('cartItems'));
 document.querySelectorAll('[data-qty]').forEach(el=>el.onclick=()=>changeQty(el.dataset.qty,Number(el.dataset.delta)));
}
async function persistCart(){
 if(!user){saveGuest();updateCart();return}
 cartBusy=true;updateCart();
 try{
  const items=Object.entries(cart).filter(([id,q])=>Number(q)>0).map(([id,quantity])=>({productId:Number(id),quantity:Number(quantity)}));
  await request('/api/cart/create',{method:'POST',body:JSON.stringify(items)});
 }catch(e){notify('Cart could not sync: '+e.message,true);throw e}
 finally{cartBusy=false;updateCart()}
}
async function changeQty(id,delta){
 const p=productById(id);if(!p||cartBusy)return false;
 const next=Math.max(0,Math.min(99,Number(cart[id]||0)+delta));
 if(next>p.stock){notify('Only '+p.stock+' available right now',true);return false}
 const before={...cart};
 if(next)cart[id]=next;else delete cart[id];
 updateCart();
 try{await persistCart();return true}catch{cart=before;updateCart();return false}
}
function showCartNudge(p){
 const bar=$('cartNudge');
 $('cartNudgeText').textContent=p.name+' added to your bag';
 bar.hidden=false;bar.classList.add('show');
 clearTimeout(showCartNudge.timer);
 showCartNudge.timer=setTimeout(()=>{bar.hidden=true;bar.classList.remove('show')},6500);
}
async function addItem(id){
 if(await changeQty(id,1)){
  const p=productById(id);
  if(p)showCartNudge(p);
 }
}
async function loadWishlist(){
 wishlistIds=new Set();
 if(!user){drawProducts();return}
 try{const list=await request('/api/wishlist');wishlistIds=new Set(list.map(x=>String(x.productId)))}
 catch(e){console.warn('Wishlist unavailable:',e.message)}
 drawProducts();
}
async function toggleWishlist(id){
 if(!user && !await login('LOGIN'))return;
 const key=String(id);
 try{
  const saved=wishlistIds.has(key);
  await request('/api/wishlist/'+encodeURIComponent(key),{method:saved?'DELETE':'POST'});
  await loadWishlist();
  notify(saved?'Removed from saved items.':'Saved to your wishlist.');
 }catch(e){notify('Wishlist update failed: '+e.message,true)}
}
async function showWishlist(){
 if(!user && !await login('LOGIN'))return;
 try{
  const items=await request('/api/wishlist');
  const d=$('modal'),root=$('modalContent');root.replaceChildren();
  const h=document.createElement('h2');h.textContent='SAVED ITEMS';root.append(h);
  const intro=document.createElement('p');
  intro.textContent=items.length?items.length+' saved item'+(items.length===1?'':'s'):'Your wishlist is empty. Tap ♡ on any product to save it.';
  root.append(intro);
  for(const item of items){
   const row=document.createElement('div');row.className='wish-row';
   const body=document.createElement('div');body.className='wish-row-info';
   const title=document.createElement('strong');title.textContent=item.name;
   const subtitle=document.createElement('small');subtitle.textContent=item.category+' · '+money(item.price);
   body.append(title,subtitle);
   const controls=document.createElement('div');controls.className='wish-actions';
   const add=document.createElement('button');add.textContent=item.stock>0?'ADD TO CART':'SOLD OUT';
   add.disabled=!(item.stock>0);add.onclick=()=>{d.close();addItem(item.productId)};
   const remove=document.createElement('button');remove.textContent='REMOVE';
   remove.onclick=async()=>{
    try{
     await request('/api/wishlist/'+encodeURIComponent(item.productId),{method:'DELETE'});
     d.close();await loadWishlist();await showWishlist();
    }catch(e){notify('Could not remove item: '+e.message,true)}
   };
   controls.append(add,remove);row.append(body,controls);root.append(row);
  }
  const close=document.createElement('button');close.className='outline-button';
  close.textContent='CLOSE';close.onclick=()=>d.close();root.append(close);
  d.showModal();
 }catch(e){notify('Could not load wishlist: '+e.message,true)}
}

function openCart(){$('overlay').hidden=false;$('cartDrawer').classList.add('open');$('cartDrawer').setAttribute('aria-hidden','false')}
function closeCart(){$('overlay').hidden=true;$('cartDrawer').classList.remove('open');$('cartDrawer').setAttribute('aria-hidden','true')}
function variantOf(p){
 const m=/^(.*?) - Size (XS|S|M|L|XL|XXL|[6-9]|10|11|12)$/.exec(p.name);
 return m?{base:m[1],size:m[2]}:null;
}
// Size selection maps to real product IDs. Each size has independently enforced stock.
function presentProducts(products){
 const groups=new Map();
 const nonVariants=[];
 for(const p of products){
  const v=variantOf(p);
  if(!v){nonVariants.push(p);continue}
  if(!groups.has(v.base))groups.set(v.base,[]);
  groups.get(v.base).push({...p,sizeLabel:v.size});
 }
 const variants=[...groups.entries()].map(([base,items])=>{
  const ordered=items.sort((a,b)=>{
   const sizes=['XS','S','M','L','XL','XXL','6','7','8','9','10','11','12'];
   return sizes.indexOf(a.sizeLabel)-sizes.indexOf(b.sizeLabel);
  });
  const selected=ordered.find(x=>x.sizeLabel==='M'&&x.stock>0)||ordered.find(x=>x.stock>0)||ordered[0];
  return {...selected,name:base,stock:ordered.reduce((n,x)=>n+x.stock,0),variants:ordered};
 });
 return [...nonVariants.filter(p=>!groups.has(p.name)),...variants];
}
function drawProducts(){
 $('resultCount').textContent=visible.length+' PRODUCT'+(visible.length===1?'':'S')+' FOUND';
 $('emptyState').hidden=visible.length>0;
 $('productGrid').innerHTML=visible.map(p=>{
  const stock=Number(p.stock),icon=chooseIcon(p),safeId=Number(p.productId);
  let image=productArtwork(p);
  if(p.image&&/^https:\/\//.test(p.image))image='<img data-product-image="'+safeId+'" loading="lazy" src="'+escape(p.image)+'" alt="'+escape(p.name)+'">';
  const off=p.originalPrice>p.price?Math.round((p.originalPrice-p.price)*100/p.originalPrice):0;
  const deal=off>0?'<span class="discount-label">'+off+'% OFF</span>':'';
  const choices=p.variants?'<label class="card-size-picker">SIZE <select aria-label="Choose size for '+escape(p.name)+'" data-variant-select>'+p.variants.map(v=>'<option value="'+v.productId+'" '+(v.stock<1?'disabled':'')+' '+(v.productId===p.productId?'selected':'')+'>'+escape(v.sizeLabel)+(v.stock<1?' · SOLD OUT':'')+'</option>').join('')+'</select></label>':'';
  return '<article class="product-card"><div class="product-visual" style="--tone:'+ (tones[p.category]||'#e7f0ed')+'"><span class="tag">'+(stock>0?'IN STOCK':'SOLD OUT')+'</span>'+deal+image+'<button type="button" class="wishlist-toggle" data-wish="'+safeId+'" aria-pressed="'+wishlistIds.has(String(safeId))+'" aria-label="Save to wishlist">'+(wishlistIds.has(String(safeId))?'♥':'♡')+'</button>'+'</div><div class="product-info"><div class="meta"><span>'+escape(p.category)+'</span><span>⌖ '+escape(p.city||'India')+'</span></div><h3>'+escape(p.name)+'</h3><p class="description">'+escape(p.description)+'</p>'+choices+'<div class="product-bottom"><div class="price-stack"><strong class="price">'+money(itemPrice(p))+'</strong>'+(off>0?'<del>'+money(p.originalPrice)+'</del>':'')+'</div><button class="add-button" data-add="'+safeId+'" '+(stock<1?'disabled':'')+'>'+(stock<1?'SOLD OUT':'ADD +')+'</button></div></div></article>';
 }).join('');
 bindImageFallbacks($('productGrid'));
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
  const chooser=b.closest('.product-card').querySelector('[data-variant-select]');
  addItem(chooser?chooser.value:b.dataset.add);
 });
 document.querySelectorAll('[data-wish]').forEach(button=>button.onclick=()=>{
  const chooser=button.closest('.product-card').querySelector('[data-variant-select]');
  toggleWishlist(chooser?chooser.value:button.dataset.wish);
 });
 document.querySelectorAll('[data-variant-select]').forEach(select=>select.onchange=()=>{
  const button=select.closest('.product-card').querySelector('[data-wish]');
  if(button){
   const saved=wishlistIds.has(select.value);
   button.setAttribute('aria-pressed',String(saved));
   button.textContent=saved?'♥':'♡';
  }
 });
}
function renderCategoryShowcase(){
 $('categoryShowcase').innerHTML=productCategories.map(c=>{
  const count=catalog.filter(p=>p.category===c.name).length;
  return '<button class="category-tile" type="button" data-category-tile="'+escape(c.name)+'"><span class="category-tile-icon">'+c.icon+'</span><strong>'+escape(c.name)+'</strong><small>'+count+' PRODUCTS · '+escape(c.sub)+'</small><span class="category-tile-arrow">EXPLORE ↗</span></button>';
 }).join('');
 $('categoryShowcase').querySelectorAll('[data-category-tile]').forEach(b=>b.onclick=()=>setCategory(b.dataset.categoryTile));
}
function renderDeals(){
 const active=presentProducts(catalog).filter(p=>p.stock>0);
 const discounted=active.filter(p=>Number(p.originalPrice)>Number(p.price)).sort((a,b)=>
  ((b.originalPrice-b.price)/b.originalPrice)-((a.originalPrice-a.price)/a.originalPrice));
 const deals=discounted.length?discounted.slice(0,6):active.slice().sort((a,b)=>b.stock-a.stock).slice(0,6);
 $('dealsTitle').textContent=discounted.length?'DEALS WITH REAL MARKDOWNS':'POPULAR PICKS';
 $('dealsSubtitle').textContent=discounted.length?'Prices from the live product catalog. No countdown gimmicks.':'Selected from currently available products; no fake discounts.';
 $('dealGrid').innerHTML=deals.map(p=>{
  const original=Number(p.originalPrice),discount=original>p.price?Math.round((original-p.price)*100/original):0;
  const thumb=p.image&&/^https:\/\//.test(p.image)?'<img data-product-image="'+p.productId+'" loading="lazy" src="'+escape(p.image)+'" alt="'+escape(p.name)+'">':productArtwork(p);
  return '<article class="deal-card"><div class="deal-image">'+thumb+'</div><div class="deal-details"><small>'+escape(p.category)+'</small><strong>'+escape(p.name)+'</strong><div class="deal-pricing"><b>'+money(itemPrice(p))+'</b>'+(discount?'<del>'+money(original)+'</del><span>'+discount+'% off</span>':'')+'</div><button type="button" class="deal-add" data-deal-add="'+p.productId+'">ADD TO BAG +</button></div></article>';
 }).join('');
 bindImageFallbacks($('dealGrid'));
 $('dealGrid').querySelectorAll('[data-deal-add]').forEach(b=>b.onclick=()=>addItem(b.dataset.dealAdd));
}
function matchingCatalog(products,{category:cat,city,range,query}){
 const [min,max]=range?range.split('-').map(Number):[null,null];
 const needle=(query||'').trim().toLowerCase();
 return products.filter(p=>
  (cat==='All'||p.category===cat)&&
  (!city||p.city===city)&&
  (!range||(p.price>=min&&p.price<=max))&&
  (!needle||[p.name,p.description,p.category,p.city].some(v=>String(v||'').toLowerCase().includes(needle)))
 );
}
async function applyFilters(){
 const sequence=++searchRequestSeq;
 const city=$('cityFilter').value,range=$('priceFilter').value,sort=$('sortFilter').value;
 const matches=matchingCatalog(catalog,{category,city,range,query:searchText});
 let products=matches;
 if(searchText||category!=='All'||city||range){
  const params=new URLSearchParams({q:searchText,size:'100'});
  if(category!=='All')params.set('category',category);
  if(city)params.set('city',city);
  if(range){const [min,max]=range.split('-');params.set('minPrice',min);params.set('maxPrice',max)}
  $('sourceStatus').textContent='● SEARCHING LIVE INVENTORY…';
  try{
   const data=await request('/api/search/products?'+params);
   if(sequence!==searchRequestSeq)return;
   const hits=(data.hits?.hits||[]).map(hit=>String(hit._source?.productId));
   const ids=new Set(hits);
   const ranked=catalog.filter(p=>ids.has(String(p.productId)));
   products=ranked.concat(matches.filter(p=>!ids.has(String(p.productId))));
   $('sourceStatus').textContent=ranked.length?'● OPENSEARCH + LIVE POSTGRESQL':'● LIVE POSTGRESQL MATCHES';
  }catch(e){
   if(sequence!==searchRequestSeq)return;
   products=matches;
   $('sourceStatus').textContent='● POSTGRESQL SEARCH FALLBACK';
   console.warn('OpenSearch unavailable; PostgreSQL results shown:',e.message);
  }
 }else $('sourceStatus').textContent='● LIVE POSTGRESQL INVENTORY';
 if(sequence!==searchRequestSeq)return;
 if(sort==='price-asc')products.sort((a,b)=>a.price-b.price);
 if(sort==='price-desc')products.sort((a,b)=>b.price-a.price);
 if(sort==='name')products.sort((a,b)=>a.name.localeCompare(b.name));
 visible=presentProducts(products);drawProducts();
}
function setCategory(name){
 category=name;
 document.querySelectorAll('[data-category]').forEach(x=>x.classList.toggle('active',x.dataset.category===name));
 document.querySelectorAll('.category-rail-item[data-category-nav]').forEach(x=>{
  const active=x.dataset.categoryNav===name;
  x.classList.toggle('active',active);
  x.setAttribute('aria-pressed',String(active));
 });
 document.querySelector('#catalog').scrollIntoView({behavior:'smooth'});
 applyFilters();
}
function setupFilters(){
 const categories=['All',...new Set(catalog.map(p=>p.category))];
 $('categoryChips').innerHTML=categories.map(c=>'<button class="chip '+(c===category?'active':'')+'" data-category="'+escape(c)+'">'+escape(c).toUpperCase()+'</button>').join('');
 document.querySelectorAll('[data-category]').forEach(x=>x.onclick=()=>setCategory(x.dataset.category));
 const cities=[...new Set(catalog.map(p=>p.city).filter(Boolean))].sort();
 $('cityFilter').innerHTML='<option value="">All India</option>'+cities.map(c=>'<option value="'+escape(c)+'">'+escape(c)+'</option>').join('');
}
async function loadCatalog(){
 try{
  const data=await request('/api/store/catalog');
  if(!Array.isArray(data))throw new Error('Invalid catalog response');
  catalog=data.filter(p=>p&&p.productId!=null).map(p=>({...p,price:Number(p.price),stock:Number(p.stock)}));
  if(!catalog.length){$('productGrid').innerHTML='<div class="loading-card">No products found. Enable SEED_RETAIL_CATALOG for the demo or add products through the API.</div>';return}
  setupFilters();renderCategoryShowcase();renderDeals();await applyFilters();updateCart();
 }catch(e){$('productGrid').innerHTML='<div class="loading-card">Unable to connect to the retail API on '+escape(API)+'. '+escape(e.message)+'</div>';$('sourceStatus').textContent='● BACKEND OFFLINE';notify('Backend connection failed. Check API port and CORS.',true)}
}
async function loadServerCart(){
 if(!user){cart=readGuest();updateCart();return}
 try{
  const carts=await request('/api/carts');
  const server={};
  for(const c of (Array.isArray(carts)?carts:[])){
    for(const p of (c.products||[]))if(p.productId!=null&&p.quantity>0)server[p.productId]=p.quantity;
  }
  const guest=readGuest();cart=server;
  if(Object.keys(guest).length){
    for(const [id,q] of Object.entries(guest))cart[id]=Math.min(99,Number(cart[id]||0)+Number(q||0));
    await persistCart();localStorage.removeItem('nothing-guest-cart');
  }
  updateCart();
 }catch(e){cart={};updateCart();notify('Could not restore your saved cart: '+e.message,true)}
}
async function loadRetailerStatus(){
 retailerStatus='NOT_APPLIED';retailerDiscount=0;
 if(!user)return;
 try{
  const data=await request('/api/retailer/me');
  retailerStatus=data.status||'NOT_APPLIED';
  retailerDiscount=data.status==='APPROVED'?Number(data.discountPercent||0):0;
 }catch(e){notify('Retailer status unavailable: '+e.message,true)}
}
async function verifySession(){
 try{
  // A real authenticated response includes an account ID and username.
  // /api/auth/username is public and must not be used as proof of login.
  const session=await request('/api/auth/user');
  if(!session||!session.id||!session.username||session.username==='anonymousUser'){
   user=null;return null;
  }
  user=session.username;
  return session;
 }catch(e){user=null;return null}
}
async function loadSession(){
 const session=await verifySession();
 syncAccountButtons();
 $('adminRetailersBtn').hidden=!(session?.roles||[]).includes('ROLE_ADMIN');
 await loadRetailerStatus();await applyFilters();await loadServerCart();await loadWishlist();
}
function showDialog(title,fields,button='CONTINUE'){
 return new Promise(resolve=>{
  const dialog=$('modal'),root=$('modalContent');root.replaceChildren();
  const h=document.createElement('h2');h.textContent=title;root.appendChild(h);
  const form=document.createElement('form'),inputs={};
  for(const f of fields){
   const label=document.createElement('label');label.textContent=f.label;const input=document.createElement('input');
   input.name=f.name;input.required=f.required!==false;input.type=f.type||'text';input.placeholder=f.placeholder||'';input.autocomplete=f.autocomplete||'off';
   if(f.minLength)input.minLength=f.minLength;
   if(f.maxLength)input.maxLength=f.maxLength;
   if(f.pattern)input.pattern=f.pattern;
   if(f.inputMode)input.inputMode=f.inputMode;
   if(f.value!=null)input.value=f.value;
   label.append(input);form.append(label);inputs[f.name]=input;
  }
  const actions=document.createElement('div');actions.className='actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='CANCEL';
  const submit=document.createElement('button');submit.type='submit';submit.textContent=button;actions.append(cancel,submit);form.append(actions);root.append(form);
  let finished=false;const end=value=>{if(finished)return;finished=true;dialog.close();resolve(value)};
  cancel.onclick=()=>end(null);dialog.oncancel=e=>{e.preventDefault();end(null)};
  form.onsubmit=e=>{e.preventDefault();const data={};for(const [name,input] of Object.entries(inputs))data[name]=input.value.trim();end(data)};
  dialog.showModal();Object.values(inputs)[0]?.focus();
 });
}
function selectAccountMode(){
 return new Promise(resolve=>{
  const dialog=$('modal'),root=$('modalContent');root.replaceChildren();
  const title=document.createElement('h2');title.textContent='YOUR NOTHING ACCOUNT';root.append(title);
  const p=document.createElement('p');p.textContent='Choose how you want to continue.';root.append(p);
  const actions=document.createElement('div');actions.className='account-choices';root.append(actions);
  let finished=false;const end=value=>{if(finished)return;finished=true;dialog.close();resolve(value)};
  for(const [value,label] of [['LOGIN','SIGN IN'],['SIGNUP','CREATE ACCOUNT']]){
   const button=document.createElement('button');button.className='primary-choice';button.textContent=label;
   button.onclick=()=>end(value);actions.append(button);
  }
  dialog.oncancel=e=>{e.preventDefault();end(null)};
  dialog.showModal();
 });
}
async function getEmailVerificationProof(email){
 const config=await request('/api/auth/email/config');
 if(!config.required)return null;
 if(!config.available)throw new Error('Email verification is required but email delivery is not configured. Contact the store administrator.');
 await request('/api/auth/email/start',{method:'POST',body:JSON.stringify({email})});
 notify('A six-digit verification code was sent to '+email+'.');
 const answer=await showDialog('CHECK YOUR EMAIL',[{name:'code',label:'SIX-DIGIT CODE (EXPIRES IN 10 MINUTES)',placeholder:'123456',inputMode:'numeric',pattern:'[0-9]{6}',maxLength:6}],'VERIFY EMAIL');
 if(!answer)throw new Error('Email verification cancelled.');
 const proof=await request('/api/auth/email/confirm',{method:'POST',body:JSON.stringify({email,code:answer.code})});
 if(!proof.token)throw new Error('Email verification failed.');
 return proof.token;
}
async function ensureVerifiedEmail(){
 const state=await request('/api/auth/email/status');
 if(!state.required||state.verified)return true;
 const proof=await getEmailVerificationProof(state.email);
 if(!proof)return false;
 const updated=await request('/api/auth/email/activate',{method:'POST',body:JSON.stringify({token:proof})});
 if(!updated.verified)throw new Error('Email ownership could not be confirmed.');
 notify('Email address verified! You can now place orders.');
 return true;
}
async function login(mode=null){
 const choice=mode||await selectAccountMode();
 if(!choice)return false;
 const signup=choice==='SIGNUP';
 const fields=[{name:'username',label:'USERNAME',autocomplete:'username',minLength:3}];
 if(signup)fields.push({name:'email',label:'EMAIL ADDRESS',type:'email',autocomplete:'email'});
 fields.push({name:'password',label:'PASSWORD',type:'password',autocomplete:signup?'new-password':'current-password',minLength:6});
 const data=await showDialog(signup?'CREATE YOUR ACCOUNT':'WELCOME BACK',fields,signup?'SIGN UP':'SIGN IN');
 if(!data)return false;
 try{
  if(signup){
   const token=await getEmailVerificationProof(data.email);
   if(token)data.emailVerificationToken=token;
   await request('/api/auth/signup',{method:'POST',body:JSON.stringify(data)});
  }
  await request('/api/auth/signin',{method:'POST',body:JSON.stringify({username:data.username,password:data.password})});
  const session=await verifySession();
  if(!session)throw new Error('Sign-in cookie was not accepted. Use http://localhost:8000 and enable site cookies.');
  syncAccountButtons();
  $('adminRetailersBtn').hidden=!(session.roles||[]).includes('ROLE_ADMIN');
  await loadRetailerStatus();await applyFilters();await loadServerCart();await loadWishlist();notify('Welcome, '+user+'! Your cart is synced.');
  return true;
 }catch(e){notify('Account error: '+e.message,true);return false}
}
function closeAccountMenu(){
 $('accountMenu').hidden=true;
 $('accountBtn').setAttribute('aria-expanded','false');
}
function toggleAccountMenu(){
 const menu=$('accountMenu');
 const open=menu.hidden;
 menu.hidden=!open;
 $('accountBtn').setAttribute('aria-expanded',String(open));
}
function syncAccountButtons(){
 // A single Login/Account menu, with working actions for either account state.
 $('signInBtn').hidden=true;
 $('registerBtn').hidden=true;
 $('accountBtn').hidden=false;
 $('logoutBtn').hidden=true;
 $('accountLabel').textContent=user?user.toUpperCase():'LOGIN';
 $('menuWelcome').textContent=user?'Hello, '+user+'!':'New customer? Create your account';
 $('accountMenu').querySelector('.menu-guest').hidden=!!user;
 $('accountMenu').querySelector('.menu-member').hidden=!user;
 closeAccountMenu();
}
async function logout(){
 try{await request('/api/auth/signout',{method:'POST'})}
 catch(e){notify('Could not sign out securely: '+e.message,true);return}
 user=null;cart={};wishlistIds=new Set();retailerStatus='NOT_APPLIED';retailerDiscount=0;
 $('adminRetailersBtn').hidden=true;
 // Do not transfer one customer's bag to the next shopper on the same device.
 localStorage.removeItem('nothing-guest-cart');
 syncAccountButtons();await applyFilters();updateCart();
 notify('Signed out. Your saved account bag remains in PostgreSQL.');
}
async function accountAction(){await showAccountOverview()}
async function retailerAction(){
 if(!user && !await login())return;
 try{
  await loadRetailerStatus();
  if(retailerStatus==='APPROVED'){
   const result=await showDialog('RETAILER ACCOUNT APPROVED',[{name:'status',label:'APPROVED · '+retailerDiscount+'% DISCOUNT ON ALL STORE ITEMS',placeholder:'THANK YOU'}],'CLOSE');
   return;
  }
  if(retailerStatus==='PENDING'){
   await informationModal('VERIFICATION PENDING','Your GSTIN is submitted. A store administrator must check it against official GST records before activating retailer prices. No discount is active yet.');
   return;
  }
  const data=await showDialog('APPLY FOR RETAILER PRICING',[
   {name:'businessName',label:'REGISTERED BUSINESS NAME',placeholder:'Your GST registered business',minLength:3},
   {name:'gstin',label:'GSTIN (REQUIRED — 15 CHARACTERS)',placeholder:'29ABCDE1234F1Z5',minLength:15}
  ],'SUBMIT FOR REVIEW');
  if(!data)return;
  const result=await request('/api/retailer/apply',{method:'POST',body:JSON.stringify(data)});
  retailerStatus=result.status;
  await informationModal('APPLICATION SUBMITTED','Your request is now PENDING. An administrator must verify GST registration before retailer discounts begin.');
 }catch(e){notify('Retailer application failed: '+e.message,true)}
}
function informationModal(title,message){
 return new Promise(resolve=>{
  const d=$('modal'),root=$('modalContent');root.replaceChildren();
  const heading=document.createElement('h2');heading.textContent=title;
  const p=document.createElement('p');p.textContent=message;
  const done=document.createElement('button');done.className='outline-button';done.textContent='CLOSE';
  done.onclick=()=>{d.close();resolve()};
  d.oncancel=()=>resolve();root.append(heading,p,done);d.showModal();
 });
}
async function reviewRetailers(){
 try{
  const items=await request('/api/admin/retailers');
  const d=$('modal'),root=$('modalContent');root.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='RETAILER APPROVAL QUEUE';root.append(heading);
  const help=document.createElement('p');help.textContent='Use gst.gov.in > Search Taxpayer to verify the GSTIN and legal name. Approve only after successful verification.';root.append(help);
  if(!items.length){const empty=document.createElement('p');empty.textContent='No pending retailer applications.';root.append(empty)}
  for(const item of items){
   const block=document.createElement('section');block.className='review-card';
   const name=document.createElement('strong');name.textContent=item.businessName+' · '+item.gstin;block.append(name);
   const row=document.createElement('div');row.className='actions';
   for(const decision of ['APPROVED','REJECTED']){
    const btn=document.createElement('button');btn.type='button';btn.textContent=decision==='APPROVED'?'APPROVE':'REJECT';
    btn.onclick=async()=>{
     try{
      await request('/api/admin/retailers/'+item.id+'/review',{method:'PUT',body:JSON.stringify({decision,note:'Reviewed by store administrator'})});
      notify(item.businessName+' marked '+decision.toLowerCase());d.close();await reviewRetailers();
     }catch(e){notify('Review failed: '+e.message,true)}
    };row.append(btn)
   }
   block.append(row);root.append(block);
  }
  const exit=document.createElement('button');exit.className='outline-button';exit.textContent='CLOSE';exit.onclick=()=>d.close();root.append(exit);d.showModal();
 }catch(e){notify('Approval queue unavailable: '+e.message,true)}
}
async function showOrders(){
 if(!user){if(!await login('LOGIN'))return}
 try{
  const data=await request('/api/customer/orders');
  const orders=Array.isArray(data)?data:[];
  const root=$('modalContent');root.replaceChildren();
  const title=document.createElement('h2');title.textContent='MY ORDERS';
  root.append(title);
  const p=document.createElement('p');p.textContent=orders.length
   ?orders.length+' order'+(orders.length===1?'':'s')+' on your account'
   :'No orders placed yet. Your next great find is waiting.';
  root.append(p);
  for(const order of orders){
   const row=document.createElement('section');row.className='order-history-card';
   const h=document.createElement('h3');
   h.textContent='Order #'+order.orderId+' · '+money(order.totalAmount);
   row.append(h);
   const meta=document.createElement('p');
   const method=order.payment?.paymentMethod==='CASH_ON_DELIVERY'?'Cash on delivery'
     :order.payment?.paymentMethod==='STRIPE'?'Stripe paid online':'Payment method unavailable';
   const paymentState=order.payment?.pgStatus==='PAID'?'Paid'
     :method==='Cash on delivery'?'Pay on delivery':'Payment pending verification';
   meta.textContent=(order.orderDate||'Date pending')+' · '+(order.orderStatus||'Accepted')
     +' · '+method+' · '+paymentState;
   row.append(meta);
   for(const item of order.orderItems||[]){
    const name=item.product?.productName||'Purchased item';
    const entry=document.createElement('div');entry.className='order-history-line';
    const title=document.createElement('span');title.textContent=name+' × '+item.quantity;
    const amount=document.createElement('strong');amount.textContent=money(item.orderedProductPrice*item.quantity);
    entry.append(title,amount);row.append(entry);
   }
   root.append(row);
  }
  const close=document.createElement('button');close.className='outline-button';
  close.textContent='CLOSE';close.onclick=()=>$('modal').close();
  root.append(close);$('modal').showModal();
 }catch(e){notify('Order history is temporarily unavailable: '+e.message,true)}
}
async function resumeStripeCheckout(){
 const url=new URL(location.href),state=url.searchParams.get('checkout');
 if(!state)return;
 url.searchParams.delete('checkout');
 const sessionId=url.searchParams.get('session_id');
 url.searchParams.delete('session_id');
 history.replaceState(null,'',url.toString());
 if(state==='stripe-cancel'){
  notify('Stripe checkout was cancelled. No order was placed; your cart is saved.');return;
 }
 if(state==='stripe-success'){
  if(!sessionId){notify('Payment returned but Stripe session reference is missing. Check your orders.',true);return}
  try{
   const data=await request('/api/checkout/stripe/status?sessionId='+encodeURIComponent(sessionId));
   if(data.status==='COMPLETED'){
    cart={};saveGuest();updateCart();
    notify('Stripe payment verified and order #'+data.orderId+' placed.');
    await loadCatalog();return;
   }
   notify('Payment submitted. Order confirmation is awaiting the verified Stripe webhook. Check ORDERS shortly.');
  }catch(e){notify('Payment status needs verification: '+e.message,true)}
 }
}
function addressFields(a={}){
 return [
  {name:'recipientName',label:'FULL NAME OF RECIPIENT',placeholder:'As on delivery contact',minLength:2,maxLength:80,value:a.recipientName||''},
  {name:'phoneNumber',label:'MOBILE NUMBER (10–15 DIGITS)',placeholder:'9876543210',type:'tel',inputMode:'tel',pattern:'\\+?[0-9]{10,15}',value:a.phoneNumber||''},
  {name:'buildingName',label:'FLAT / HOUSE / BUILDING',placeholder:'Flat 202, Block B',minLength:5,value:a.buildingName||''},
  {name:'street',label:'STREET / AREA',placeholder:'Main Road, Indiranagar',minLength:5,value:a.street||''},
  {name:'landmark',label:'LANDMARK (OPTIONAL)',placeholder:'Near metro station',required:false,value:a.landmark||''},
  {name:'city',label:'CITY',placeholder:'Bengaluru',minLength:2,value:a.city||''},
  {name:'state',label:'STATE',placeholder:'Karnataka',minLength:2,value:a.state||''},
  {name:'country',label:'COUNTRY',placeholder:'India',value:a.country||'India'},
  {name:'pincode',label:'SIX-DIGIT PIN CODE',placeholder:'560001',inputMode:'numeric',pattern:'[0-9]{6}',value:a.pincode||''},
  {name:'addressLabel',label:'SAVE AS (OPTIONAL)',placeholder:'Home / Work',required:false,maxLength:24,value:a.addressLabel||''}
 ];
}
function addressSummary(a){
 return [a.addressLabel||'DELIVERY ADDRESS',a.recipientName||'Name needed',a.phoneNumber||'Phone needed',a.buildingName,a.street,a.landmark,a.city,a.state,a.pincode,a.country].filter(Boolean).join(' · ');
}
function completeAddress(a){
 return !!(a&&a.recipientName&&a.recipientName.trim().length>=2&&/^\+?[0-9]{10,15}$/.test(a.phoneNumber||'')&&/^[0-9]{6}$/.test(a.pincode||''));
}
async function editAddress(a=null){
 const fields=addressFields(a||{});
 const data=await showDialog(a?'UPDATE DELIVERY DETAILS':'ADD DELIVERY ADDRESS',fields,a?'SAVE CHANGES':'SAVE ADDRESS');
 if(!data)return null;
 try{
  const valid=completeAddress(data);
  if(!valid)throw new Error('Enter a recipient name, valid mobile number and six-digit PIN.');
  const saved=await request(a?'/api/addresses/'+a.addressId:'/api/addresses',
      {method:a?'PUT':'POST',body:JSON.stringify(data)});
  notify('Delivery address saved successfully.');
  return saved;
 }catch(e){notify('Address not saved: '+e.message,true);return null}
}
function chooseSavedAddress(addresses){
 return new Promise(resolve=>{
  const d=$('modal'),root=$('modalContent');root.replaceChildren();
  const h=document.createElement('h2');h.textContent='DELIVER TO';root.append(h);
  const hint=document.createElement('p');hint.textContent='Choose a saved address. Recipient and phone number are required.';root.append(hint);
  let closed=false;
  const done=x=>{if(closed)return;closed=true;d.close();resolve(x)};
  for(const a of addresses){
   const btn=document.createElement('button');btn.type='button';btn.className='address-choice';
   btn.innerHTML='<strong>'+escape(a.addressLabel||'SAVED ADDRESS')+'</strong><span>'+escape(addressSummary(a))+'</span><small>'+(completeAddress(a)?'SELECT THIS ADDRESS':'ADD PHONE DETAILS TO CONTINUE')+'</small>';
   btn.onclick=()=>done({action:completeAddress(a)?'select':'edit',address:a});root.append(btn);
  }
  const add=document.createElement('button');add.type='button';add.className='outline-button';add.textContent='+ ADD A NEW ADDRESS';add.onclick=()=>done({action:'add'});root.append(add);
  const cancel=document.createElement('button');cancel.type='button';cancel.className='link-button';cancel.textContent='CANCEL';cancel.onclick=()=>done(null);root.append(cancel);
  d.oncancel=e=>{e.preventDefault();done(null)};d.showModal();
 });
}
async function selectDeliveryAddress(){
 while(true){
  const addresses=await request('/api/users/addresses');
  if(!Array.isArray(addresses)||!addresses.length)return await editAddress();
  const selection=await chooseSavedAddress(addresses);
  if(!selection)return null;
  if(selection.action==='select')return selection.address;
  const saved=await editAddress(selection.action==='edit'?selection.address:null);
  if(saved)return saved;
 }
}
async function showAccountOverview(){
 if(!user){await login('LOGIN');return}
 try{
  const [session,addresses,emailState,config]=await Promise.all([
   request('/api/auth/user'),request('/api/users/addresses'),request('/api/auth/email/status'),request('/api/auth/email/config')
  ]);
  const d=$('modal'),root=$('modalContent');root.replaceChildren();
  const title=document.createElement('h2');title.textContent='MY ACCOUNT';root.append(title);
  const intro=document.createElement('p');intro.textContent=session.username+' · '+session.email;root.append(intro);
  const section=document.createElement('div');section.className='account-overview';
  const verification=document.createElement('p');
  verification.textContent=emailState.verified?'✓ Email inbox verified':'Email inbox not yet verified';
  verification.className=emailState.verified?'verified-email-label':'unverified-email-label';
  section.append(verification);
  if(!emailState.verified&&config.available){
   const verify=document.createElement('button');verify.className='outline-button';
   verify.textContent='VERIFY MY EMAIL';
   verify.onclick=async()=>{d.close();try{
    const proof=await request('/api/auth/email/start',{method:'POST',body:JSON.stringify({email:session.email})}).then(async()=>{
     const answer=await showDialog('VERIFY '+session.email,[{name:'code',label:'EMAIL CODE',pattern:'[0-9]{6}',maxLength:6}],'VERIFY');
     if(!answer)return null;
     return request('/api/auth/email/confirm',{method:'POST',body:JSON.stringify({email:session.email,code:answer.code})});
    });
    if(proof?.token)await request('/api/auth/email/activate',{method:'POST',body:JSON.stringify({token:proof.token})});
   }catch(e){notify('Email verification: '+e.message,true)}
   await showAccountOverview()};section.append(verify);
  }
  const saved=document.createElement('div');saved.innerHTML='<strong>DELIVERY ADDRESSES</strong><small>'+addresses.length+' saved</small>';section.append(saved);
  addresses.forEach(a=>{
   const b=document.createElement('button');b.className='address-choice';b.innerHTML='<strong>'+escape(a.addressLabel||'ADDRESS')+'</strong><span>'+escape(addressSummary(a))+'</span><small>EDIT DETAILS ↗</small>';
   b.onclick=async()=>{d.close();await editAddress(a);await showAccountOverview()};section.append(b);
  });
  const add=document.createElement('button');add.className='outline-button';add.textContent='+ ADD DELIVERY ADDRESS';
  add.onclick=async()=>{d.close();await editAddress();await showAccountOverview()};section.append(add);
  const orders=document.createElement('button');orders.className='outline-button';orders.textContent='MY ORDERS ↗';orders.onclick=()=>{d.close();showOrders()};section.append(orders);
  const exit=document.createElement('button');exit.className='link-button';exit.textContent='CLOSE';exit.onclick=()=>d.close();section.append(exit);
  root.append(section);d.showModal();
 }catch(e){notify('Account details unavailable: '+e.message,true)}
}

function checkoutSummary(){
 const entries=Object.entries(cart).filter(([id,q])=>Number(q)>0&&productById(id))
  .map(([id,q])=>({id,product:productById(id),quantity:Number(q)}));
 const subtotal=entries.reduce((total,x)=>total+itemPrice(x.product)*x.quantity,0);
 const regular=entries.reduce((total,x)=>total+Number(x.product.originalPrice||x.product.price)*x.quantity,0);
 return {entries,subtotal,savings:Math.max(0,regular-subtotal),
   count:entries.reduce((n,x)=>n+x.quantity,0)};
}
function checkoutItemPhoto(product,id){
 return product.image&&/^https:\/\//.test(product.image)
  ?'<img loading="lazy" data-product-image="'+escape(id)+'" src="'+escape(product.image)+'" alt="'+escape(product.name)+'">'
  :productArtwork(product);
}
function checkoutStepper(stage){
 const names=['Address','Confirm details','Payment'];
 return '<div class="checkout-stepper" aria-label="Checkout progress">'+names.map((name,i)=>
  '<div class="checkout-step '+(stage===i?'is-current':stage>i?'is-complete':'')+'" '+(stage===i?'aria-current="step"':'')+'><span>'+(i<stage?'✓':i+1)+'</span><small>'+name+'</small></div>'
 ).join('')+'</div>';
}
function checkoutPriceDetails(summary){
 return '<section class="checkout-prices"><h3>PRICE DETAILS</h3>'+
  '<div><span>Price ('+summary.count+' item'+(summary.count===1?'':'s')+')</span><strong>'+money(summary.subtotal)+'</strong></div>'+
  (summary.savings>0?'<div class="checkout-savings"><span>You save</span><strong>'+money(summary.savings)+'</strong></div>':'')+
  '<div class="checkout-final-total"><span>Amount payable</span><strong>'+money(summary.subtotal)+'</strong></div>'+
  '<p>Final stock and prices are confirmed by the backend. No unverified delivery date or fee is promised.</p></section>';
}
function showCheckoutWizard(){
 return new Promise(async resolve=>{
  const dialog=$('checkoutDialog'),root=$('checkoutContent');
  let stage=0,addresses=[],address=null,payment='COD',stripeReady=false,processing=false,finished=false,error='';
  const codCheckoutToken=crypto.randomUUID();
  const close=()=>{
   if(processing)return;
   if(dialog.open)dialog.close();
   resolve();
  };
  dialog.oncancel=e=>{e.preventDefault();close()};
  const checkoutAction=async()=>{
   if(processing||finished||!address)return;
   processing=true;error='';paint();
   try{
    await persistCart();
    if(payment==='STRIPE'){
     const result=await request('/api/checkout/stripe/session',{
      method:'POST',body:JSON.stringify({addressId:address.addressId})
     });
     if(!result.url||!/^https:\/\/checkout\.stripe\.com\//.test(result.url))
      throw new Error('Secure Stripe checkout URL unavailable');
     window.location.assign(result.url);
     return;
    }
    const result=await request('/api/order/users/payments/COD',{
     method:'POST',body:JSON.stringify({addressId:address.addressId,
      pgName:'COD',pgPaymentId:null,pgStatus:'PENDING',pgResponseMessage:'Pay on delivery',
      checkoutToken:codCheckoutToken})
    });
    if(!result.orderId)throw new Error('Order confirmation was not returned. Check ORDERS before trying again.');
    finished=true;processing=false;cart={};saveGuest();updateCart();closeCart();
    error='';
    root.innerHTML='<div class="checkout-success"><span class="checkout-success-icon">✓</span>'+
     '<h2>ORDER PLACED!</h2><p>Order #'+escape(result.orderId)+' has been confirmed.</p>'+
     '<div class="success-meta"><strong>'+money(result.totalAmount)+'</strong><span>Cash on Delivery · Pay when your order arrives</span></div>'+
     '<p>We have not assigned a delivery date yet. View your order history for updates.</p>'+
     '<button type="button" id="wizardOrders" class="checkout-main-action">VIEW MY ORDERS ↗</button>'+
     '<button type="button" id="wizardShop" class="checkout-text-action">CONTINUE SHOPPING</button></div>';
    $('wizardOrders').onclick=()=>{dialog.close();resolve();showOrders()};
    $('wizardShop').onclick=()=>{dialog.close();resolve();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})};
    loadCatalog().catch(e=>console.warn('Catalog refresh after COD:',e));
    return;
   }catch(e){
    error='Unable to confirm checkout result: '+e.message;
    processing=false;
    paint();
    notify('Check your order status before retrying if payment or network response is uncertain.',true);
   }
  };
  const editFromWizard=async existing=>{
   if(processing)return;
   const saved=await editAddress(existing||null);
   if(!saved)return;
   addresses=await request('/api/users/addresses');
   address=addresses.find(a=>String(a.addressId)===String(saved.addressId))||saved;
   error='';paint();
  };
  const paint=()=>{
   if(!dialog.open)return;
   const sum=checkoutSummary();
   const header='<header class="checkout-heading"><div><span class="eyebrow">NOTHING MARKET · SECURE CHECKOUT</span>'+
    '<h2>'+(stage===0?'Delivery address':stage===1?'Confirm details':'Select payment')+'</h2></div>'+
    '<button type="button" id="wizardClose" class="checkout-dismiss" aria-label="Close checkout">✕</button></header>'+
    checkoutStepper(stage);
   let content='';
   if(stage===0){
    content='<div class="checkout-content-grid"><section class="checkout-panel"><h3>Where should we deliver?</h3>'+
     '<p class="checkout-hint">Select a complete address or add your delivery details.</p>'+
     (addresses.length?'<div class="checkout-addresses">'+addresses.map(a=>
      '<div class="checkout-address-tile '+(address&&String(a.addressId)===String(address.addressId)?'chosen':'')+'">'+
      '<label><input type="radio" name="deliveryAddress" value="'+escape(a.addressId)+'" '+(address&&String(a.addressId)===String(address.addressId)?'checked':'')+
      (!completeAddress(a)?' disabled':'')+'><span><strong>'+escape(a.recipientName||a.addressLabel||'Saved address')+'</strong>'+
      '<small>'+escape([a.buildingName,a.street,a.city,a.state,a.pincode].filter(Boolean).join(', '))+'</small>'+
      '<small>☎ '+escape(a.phoneNumber||'Mobile number missing')+'</small></span></label>'+
      '<button type="button" class="checkout-inline-action" data-wizard-edit="'+escape(a.addressId)+'">'+(completeAddress(a)?'EDIT':'COMPLETE DETAILS')+'</button></div>'
     ).join('')+'</div>':'<p class="checkout-empty-address">No saved addresses yet.</p>')+
     '<button id="wizardAddAddress" type="button" class="checkout-add-address">＋ ADD NEW ADDRESS</button></section>'+
     checkoutPriceDetails(sum)+'</div>';
   }else if(stage===1){
    content='<div class="checkout-content-grid"><div><section class="checkout-delivery-summary">'+
      '<h3>DELIVERING TO <button type="button" id="wizardChangeAddress">CHANGE</button></h3>'+
      '<strong>📍 '+escape(address.recipientName||'')+'</strong>'+
      '<p>'+escape([address.buildingName,address.street,address.landmark,address.city,address.state,address.pincode,address.country].filter(Boolean).join(', '))+'</p>'+
      '<p>☎ '+escape(address.phoneNumber||'')+'</p></section>'+
      '<section class="checkout-panel checkout-order-lines"><h3>ORDER SUMMARY · '+sum.count+' ITEM'+(sum.count===1?'':'S')+'</h3>'+
      sum.entries.map(x=>{
        const variant=variantOf(x.product);
        return '<div class="checkout-order-line"><div class="checkout-line-photo">'+checkoutItemPhoto(x.product,x.id)+'</div>'+
         '<div class="checkout-line-detail"><strong>'+escape(variant?variant.base:x.product.name)+'</strong>'+
         '<small>'+escape(x.product.category)+(variant?' · Size '+escape(variant.size):'')+'</small>'+
         '<small>Available stock: '+escape(x.product.stock)+'</small>'+
         '<div class="checkout-line-qty"><button type="button" data-wizard-qty="'+escape(x.id)+'" data-delta="-1" aria-label="Remove one">−</button>'+
         '<b>'+x.quantity+'</b><button type="button" data-wizard-qty="'+escape(x.id)+'" data-delta="1" aria-label="Add one">+</button></div></div>'+
         '<strong class="checkout-line-price">'+money(itemPrice(x.product)*x.quantity)+'</strong></div>';
      }).join('')+'</section><p class="checkout-promise">✓ Stock is checked again when you place the order. Delivery timing depends on fulfilment.</p></div>'+
      checkoutPriceDetails(sum)+'</div>';
   }else{
    content='<div class="checkout-content-grid"><div><section class="checkout-delivery-summary">'+
      '<h3>DELIVERING TO <button type="button" id="wizardChangeAddress">CHANGE</button></h3>'+
      '<strong>📍 '+escape(address.recipientName||'')+'</strong><p>'+escape([address.buildingName,address.street,address.city,address.state,address.pincode].filter(Boolean).join(', '))+'</p>'+
      '<p>☎ '+escape(address.phoneNumber||'')+'</p></section>'+
      '<section class="checkout-panel"><h3>CHOOSE PAYMENT METHOD</h3>'+
      '<label class="checkout-pay-option '+(payment==='COD'?'chosen':'')+'"><input type="radio" name="checkoutPayment" value="COD" '+(payment==='COD'?'checked':'')+'>'+
      '<span class="pay-icon">₹</span><span><strong>CASH ON DELIVERY</strong><small>Pay when your order is delivered. No advance payment.</small></span></label>'+
      '<label class="checkout-pay-option '+(payment==='STRIPE'?'chosen':'')+'"><input type="radio" name="checkoutPayment" value="STRIPE" '+(payment==='STRIPE'?'checked':'')+
      (!stripeReady?' disabled':'')+'><span class="pay-icon">▣</span><span><strong>PAY ONLINE WITH STRIPE</strong>'+
      '<small>'+(stripeReady?'Secure card payment in Stripe hosted Checkout.':'Stripe test payment is not configured yet.')+'</small></span></label>'+
      '<p class="checkout-promise">🔒 Card numbers are entered only on Stripe, not stored by Nothing Market.</p></section></div>'+
      checkoutPriceDetails(sum)+'</div>';
   }
   const footer= '<footer class="checkout-sticky-footer">'+
    '<div><small>'+(sum.savings>0?'YOU SAVE '+money(sum.savings):sum.count+' ITEM'+(sum.count===1?'':'S'))+'</small>'+
    '<strong>'+money(sum.subtotal)+'</strong></div>'+
    '<div class="checkout-footer-controls">'+(stage>0?'<button type="button" id="wizardBack" class="checkout-back-action">BACK</button>':'')+
    '<button type="button" id="wizardNext" class="checkout-main-action" '+(processing||sum.count===0?'disabled':'')+'>'+
    (processing?'PROCESSING…':stage===0?'CONTINUE TO REVIEW ↗':stage===1?'CONTINUE TO PAYMENT ↗':
    payment==='COD'?'PLACE COD ORDER ↗':'PROCEED TO STRIPE ↗')+'</button></div></footer>';
   root.innerHTML=header+'<div class="checkout-stage-body">'+content+
    (error?'<p class="checkout-error" role="alert">'+escape(error)+'</p>':'')+'</div>'+footer;
   $('wizardClose').onclick=close;
   const back=$('wizardBack');
   if(back)back.onclick=()=>{if(!processing){stage--;error='';paint()}};
   const next=$('wizardNext');
   next.onclick=async()=>{
    if(processing)return;
    error='';
    if(stage===0){
     if(!address||!completeAddress(address)){
      error='Select a complete address with a name, mobile number and PIN.';paint();return;
     }
     stage=1;paint();return;
    }
    if(stage===1){
     if(!checkoutSummary().count){error='Your cart is empty';paint();return}
     stage=2;paint();return;
    }
    await checkoutAction();
   };
   if(stage===0){
    root.querySelectorAll('input[name="deliveryAddress"]').forEach(input=>input.onchange=()=>{
      address=addresses.find(a=>String(a.addressId)===input.value)||null;error='';paint();
    });
    root.querySelectorAll('[data-wizard-edit]').forEach(b=>b.onclick=()=>{
      editFromWizard(addresses.find(a=>String(a.addressId)===b.dataset.wizardEdit));
    });
    $('wizardAddAddress').onclick=()=>editFromWizard(null);
   }else{
    const change=$('wizardChangeAddress');
    if(change)change.onclick=()=>{if(!processing){stage=0;error='';paint()}};
   }
   if(stage===1){
    root.querySelectorAll('[data-wizard-qty]').forEach(b=>b.onclick=async()=>{
      if(processing)return;
      processing=true;
      root.querySelectorAll('button').forEach(b=>b.disabled=true);
      const ok=await changeQty(b.dataset.wizardQty,Number(b.dataset.delta));
      processing=false;error='';
      if(!checkoutSummary().count){closeCart();close();notify('Your bag is empty. Add something to continue.',true);return}
      if(!ok)error='Could not update quantity; stock or cart synchronization may have changed.';
      paint();
    });
   }
   if(stage===2)root.querySelectorAll('input[name="checkoutPayment"]').forEach(input=>input.onchange=()=>{
    if(!processing){payment=input.value;paint()}
   });
   bindImageFallbacks(root);
   if(processing)root.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  };
  try{
   addresses=await request('/api/users/addresses');
   if(!Array.isArray(addresses))addresses=[];
   address=addresses.find(completeAddress)||null;
   try{
    const config=await request('/api/checkout/stripe/config');
    stripeReady=config.enabled===true;
   }catch{stripeReady=false}
   dialog.showModal();paint();
  }catch(e){notify('Could not start checkout: '+e.message,true);resolve()}
 });
}
let checkoutOpening=false;
async function checkout(){
 if(cartBusy||checkoutOpening)return;
 if(!checkoutSummary().count){notify('Add a product before checking out.',true);return}
 checkoutOpening=true;
 try{
  const current=await verifySession();
  if(!current){
   user=null;syncAccountButtons();closeCart();
   if(!await login('LOGIN'))return;
  }
  await ensureVerifiedEmail();
  await persistCart();
  closeCart();
  await showCheckoutWizard();
 }catch(e){notify('Checkout could not start: '+e.message,true)}
 finally{checkoutOpening=false}
}


function bind(){
 $('year').textContent=new Date().getFullYear();
 $('cartBtn').onclick=openCart;
 $('bottomCartBtn').onclick=openCart;
 $('nudgeCartBtn').onclick=()=>{$('cartNudge').hidden=true;openCart()};
 $('nudgeContinueBtn').onclick=()=>{$('cartNudge').hidden=true;document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})};
 $('bottomHomeBtn').onclick=()=>{window.scrollTo({top:0,behavior:'smooth'})};
 $('bottomCategoriesBtn').onclick=()=>{$('categories').scrollIntoView({behavior:'smooth'})};
 $('bottomDealsBtn').onclick=()=>{$('deals').scrollIntoView({behavior:'smooth'})};
 $('bottomAccountBtn').onclick=accountAction;$('closeCart').onclick=closeCart;$('overlay').onclick=closeCart;
 $('accountBtn').onclick=toggleAccountMenu;
 $('signInBtn').onclick=()=>login('LOGIN');
 $('registerBtn').onclick=()=>login('SIGNUP');
 $('logoutBtn').onclick=logout;
 $('menuLogin').onclick=()=>{closeAccountMenu();login('LOGIN')};
 $('menuRegister').onclick=()=>{closeAccountMenu();login('SIGNUP')};
 $('menuProfile').onclick=()=>{closeAccountMenu();showAccountOverview()};
 $('menuAddresses').onclick=()=>{closeAccountMenu();showAccountOverview()};
 $('menuOrders').onclick=()=>{closeAccountMenu();showOrders()};
 $('menuWishlist').onclick=()=>{closeAccountMenu();showWishlist()};
 $('menuRetailer').onclick=()=>{closeAccountMenu();retailerAction()};
 $('menuLogout').onclick=()=>{closeAccountMenu();logout()};
 document.addEventListener('click',e=>{
  if(!$('accountMenu').hidden && !e.target.closest('.account-header-menu'))closeAccountMenu();
 });
 $('ordersBtn').onclick=showOrders;$('checkoutBtn').onclick=checkout;
 $('retailerBtn').onclick=retailerAction;$('retailerCta').onclick=retailerAction;$('adminRetailersBtn').onclick=reviewRetailers;
 $('searchGo').onclick=()=>{searchText=$('search').value.trim();applyFilters();$('catalog').scrollIntoView({behavior:'smooth'})};
 $('search').addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(searchDebounce);$('searchGo').click()}});
 $('search').addEventListener('input',()=>{clearTimeout(searchDebounce);searchDebounce=setTimeout(()=>{searchText=$('search').value.trim();applyFilters()},350)});
 $('search').addEventListener('search',()=>{searchText=$('search').value.trim();applyFilters()});
 ['cityFilter','priceFilter','sortFilter'].forEach(id=>$(id).onchange=applyFilters);
 document.querySelectorAll('[data-category-nav]').forEach(el=>el.onclick=()=>setCategory(el.dataset.categoryNav));
 $('clearFilters').onclick=()=>{searchText='';$('search').value='';$('cityFilter').value='';$('priceFilter').value='';setCategory('All')};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCart();closeAccountMenu()}});
}
bind();syncAccountButtons();loadCatalog().then(loadSession).then(resumeStripeCheckout);
})();