(() => {
'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
const API=(localStorage.getItem('nothing-api-url')||'http://localhost:8090').replace(/\/$/,'');
let catalog=[],visible=[],category='All',searchText='',user=null,cart={},cartBusy=false,retailerStatus='NOT_APPLIED',retailerDiscount=0,searchRequestSeq=0,searchDebounce;
const productById=id=>catalog.find(p=>String(p.productId)===String(id));
const itemPrice=p=>retailerStatus==='APPROVED'?Math.round((p.price*(100-retailerDiscount)/100)*100)/100:p.price;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={'Electronics':'🎧','Fashion':'👟','Home & Living':'💡','Grocery':'🛒','Beauty':'🧴','Coffee':'☕'};
const tones={'Electronics':'#e8eefa','Fashion':'#ffede8','Home & Living':'#f2eddc','Grocery':'#ecf6db','Beauty':'#ffecf2','Coffee':'#f5e9d8'};
const chooseIcon=p=>/watch/i.test(p.name)?'⌚':/charger/i.test(p.name)?'🔌':/speaker/i.test(p.name)?'🔊':/backpack/i.test(p.name)?'🎒':/shirt/i.test(p.name)?'👕':/rice/i.test(p.name)?'🍚':/almond/i.test(p.name)?'🥜':/bottle/i.test(p.name)?'🧊':/bedsheet/i.test(p.name)?'🛏️':/sunscreen/i.test(p.name)?'☀️':icons[p.category]||'📦';
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
 $('cartTotal').textContent=money(items.reduce((n,[id,q])=>n+itemPrice(productById(id))*q,0));
 $('cartItems').innerHTML=items.length?items.map(([id,q])=>{
   const p=productById(id);const thumb=p.image&&/^https:\/\//.test(p.image)?'<img loading="lazy" src="'+escape(p.image)+'" alt="">':chooseIcon(p);return '<div class="cart-row"><div class="cart-icon">'+thumb+'</div><div><strong>'+escape(p.name)+'</strong><small>'+escape(p.category)+' · '+escape(p.city||'India')+'</small><div class="qty"><button type="button" data-qty="'+id+'" data-delta="-1" aria-label="Decrease quantity">−</button><b>'+q+'</b><button type="button" data-qty="'+id+'" data-delta="1" aria-label="Increase quantity">+</button></div></div><div class="cart-price">'+money(itemPrice(p)*q)+'</div></div>';
 }).join(''):'<div class="empty-state"><strong>YOUR BAG IS EMPTY.</strong><p>Some good stuff is waiting for you.</p></div>';
 $('cartSyncStatus').textContent=user?'Saved to your PostgreSQL cart':'Guest bag saved on this device';
 $('checkoutBtn').disabled=!count||cartBusy;
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
 const p=productById(id);if(!p||cartBusy)return;
 const next=Math.max(0,Math.min(99,Number(cart[id]||0)+delta));
 if(next>p.stock){notify('Only '+p.stock+' available right now',true);return}
 const before={...cart};
 if(next)cart[id]=next;else delete cart[id];
 updateCart();
 try{await persistCart()}catch{cart=before;updateCart()}
}
async function addItem(id){await changeQty(id,1)}
function openCart(){$('overlay').hidden=false;$('cartDrawer').classList.add('open');$('cartDrawer').setAttribute('aria-hidden','false')}
function closeCart(){$('overlay').hidden=true;$('cartDrawer').classList.remove('open');$('cartDrawer').setAttribute('aria-hidden','true')}
function drawProducts(){
 $('resultCount').textContent=visible.length+' PRODUCT'+(visible.length===1?'':'S')+' FOUND';
 $('emptyState').hidden=visible.length>0;
 $('productGrid').innerHTML=visible.map(p=>{
  const stock=Number(p.stock),icon=chooseIcon(p),safeId=Number(p.productId);
  let image='<span class="emoji" aria-hidden="true">'+icon+'</span>';
  if(p.image&&/^https:\/\//.test(p.image))image='<img loading="lazy" src="'+escape(p.image)+'" alt="'+escape(p.name)+'">';
  return '<article class="product-card"><div class="product-visual" style="--tone:'+ (tones[p.category]||'#e7f0ed')+'"><span class="tag">'+(stock>0?'IN STOCK':'SOLD OUT')+'</span>'+image+'</div><div class="product-info"><div class="meta"><span>'+escape(p.category)+'</span><span>⌖ '+escape(p.city||'India')+'</span></div><h3>'+escape(p.name)+'</h3><p class="description">'+escape(p.description)+'</p><div class="product-bottom"><strong class="price">'+money(itemPrice(p))+'</strong><button class="add-button" data-add="'+safeId+'" '+(stock<1?'disabled':'')+'>'+(stock<1?'SOLD OUT':'ADD +')+'</button></div></div></article>';
 }).join('');
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addItem(b.dataset.add));
}
async function applyFilters(){
 const sequence=++searchRequestSeq;
 let products=catalog.slice();
 const city=$('cityFilter').value,range=$('priceFilter').value,sort=$('sortFilter').value;
 const [min,max]=range?range.split('-').map(Number):[null,null];
 if(searchText||category!=='All'||city||range){
  const params=new URLSearchParams({q:searchText,size:'100'});
  if(category!=='All')params.set('category',category);
  if(city)params.set('city',city);
  if(range){params.set('minPrice',String(min));params.set('maxPrice',String(max))}
  $('sourceStatus').textContent='● SEARCHING OPENSEARCH…';
  try{
   const data=await request('/api/search/products?'+params);
   if(sequence!==searchRequestSeq)return;
   const ids=new Set((data.hits?.hits||[]).map(hit=>String(hit._source?.productId)));
   products=catalog.filter(p=>ids.has(String(p.productId)));
   $('sourceStatus').textContent='● OPENSEARCH RESULTS';
  }catch(e){
   if(sequence!==searchRequestSeq)return;
   notify('Search is temporarily unavailable: '+e.message,true);
   products=[];$('sourceStatus').textContent='● SEARCH UNAVAILABLE';
  }
 }else $('sourceStatus').textContent='● LIVE POSTGRESQL INVENTORY';
 if(sequence!==searchRequestSeq)return;
 if(sort==='price-asc')products.sort((a,b)=>a.price-b.price);
 if(sort==='price-desc')products.sort((a,b)=>b.price-a.price);
 if(sort==='name')products.sort((a,b)=>a.name.localeCompare(b.name));
 visible=products;drawProducts();
}
function setCategory(name){
 category=name;
 document.querySelectorAll('[data-category]').forEach(x=>x.classList.toggle('active',x.dataset.category===name));
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
  setupFilters();await applyFilters();updateCart();
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
 $('accountLabel').textContent=user?user.toUpperCase():'SIGN IN';
 $('adminRetailersBtn').hidden=!(session?.roles||[]).includes('ROLE_ADMIN');
 await loadRetailerStatus();await applyFilters();await loadServerCart();
}
function showDialog(title,fields,button='CONTINUE'){
 return new Promise(resolve=>{
  const dialog=$('modal'),root=$('modalContent');root.replaceChildren();
  const h=document.createElement('h2');h.textContent=title;root.appendChild(h);
  const form=document.createElement('form'),inputs={};
  for(const f of fields){
   const label=document.createElement('label');label.textContent=f.label;const input=document.createElement('input');
   input.name=f.name;input.required=true;input.type=f.type||'text';input.placeholder=f.placeholder||'';input.autocomplete=f.autocomplete||'off';
   if(f.minLength)input.minLength=f.minLength;
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
async function login(){
 const choice=await selectAccountMode();
 if(!choice)return false;
 const signup=choice==='SIGNUP';
 const fields=[{name:'username',label:'USERNAME',autocomplete:'username',minLength:3}];
 if(signup)fields.push({name:'email',label:'EMAIL ADDRESS',type:'email',autocomplete:'email'});
 fields.push({name:'password',label:'PASSWORD',type:'password',autocomplete:signup?'new-password':'current-password',minLength:6});
 const data=await showDialog(signup?'CREATE YOUR ACCOUNT':'WELCOME BACK',fields,signup?'SIGN UP':'SIGN IN');
 if(!data)return false;
 try{
  if(signup)await request('/api/auth/signup',{method:'POST',body:JSON.stringify(data)});
  await request('/api/auth/signin',{method:'POST',body:JSON.stringify({username:data.username,password:data.password})});
  const session=await verifySession();
  if(!session)throw new Error('Sign-in cookie was not accepted. Use http://localhost:8000 and enable site cookies.');
  $('accountLabel').textContent=user.toUpperCase();
  $('adminRetailersBtn').hidden=!(session.roles||[]).includes('ROLE_ADMIN');
  await loadRetailerStatus();await applyFilters();await loadServerCart();notify('Welcome, '+user+'! Your cart is synced.');
  return true;
 }catch(e){notify('Account error: '+e.message,true);return false}
}
async function accountAction(){
 if(!user){await login();return}
 const choice=await showDialog('SIGNED IN AS '+user.toUpperCase(),[{name:'action',label:'TYPE LOGOUT TO SIGN OUT',placeholder:'LOGOUT'}],'CONTINUE');
 if(!choice||choice.action.toUpperCase()!=='LOGOUT')return;
 try{await request('/api/auth/signout',{method:'POST'});}catch{}
 user=null;cart={};retailerStatus='NOT_APPLIED';retailerDiscount=0;$('accountLabel').textContent='SIGN IN';$('adminRetailersBtn').hidden=true;saveGuest();await applyFilters();updateCart();notify('Signed out. Your account cart is kept in PostgreSQL.');
}
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
 if(!user){if(!await login())return}
 try{
  const data=await request('/api/customer/orders');
  const orders=Array.isArray(data)?data:[];
  const root=$('modalContent');root.replaceChildren();
  const title=document.createElement('h2');title.textContent='YOUR ORDERS';root.append(title);
  if(!orders.length){const p=document.createElement('p');p.textContent='No orders yet. Your next favorite find awaits!';root.append(p)}
  for(const o of orders){
   const row=document.createElement('div');row.style.cssText='padding:16px 0;border-bottom:1px solid #ddd';
   const h=document.createElement('strong');h.textContent='Order #'+o.orderId+' · '+money(o.totalAmount);
   const p=document.createElement('p');p.textContent=(o.orderDate||'')+' · '+(o.orderStatus||'Placed');row.append(h,p);root.append(row);
  }
  const close=document.createElement('button');close.className='outline-button';close.textContent='CLOSE';close.onclick=()=>$('modal').close();root.append(close);$('modal').showModal();
 }catch(e){notify('Order history is temporarily unavailable: '+e.message,true)}
}
async function choosePaymentMethod(total){
 return new Promise(resolve=>{
  const dialog=$('modal'),root=$('modalContent');root.replaceChildren();
  const h=document.createElement('h2');h.textContent='HOW WOULD YOU LIKE TO PAY?';
  const p=document.createElement('p');p.textContent='Order total: '+money(total);
  root.append(h,p);
  const choices=document.createElement('div');choices.className='account-choices';root.append(choices);
  let finished=false;
  const done=v=>{if(finished)return;finished=true;dialog.close();resolve(v)};
  for(const [method,label] of [['COD','CASH ON DELIVERY'],['STRIPE','PAY SECURELY WITH STRIPE']]){
   const b=document.createElement('button');b.type='button';b.className='primary-choice';
   b.textContent=label;b.onclick=()=>done(method);choices.append(b);
  }
  const cancel=document.createElement('button');cancel.className='outline-button';
  cancel.textContent='CANCEL';cancel.onclick=()=>done(null);root.append(cancel);
  dialog.oncancel=e=>{e.preventDefault();done(null)};dialog.showModal();
 });
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
async function checkout(){
 let checkoutStage='checking account';
 if(cartBusy)return;
 if(!Object.values(cart).some(n=>n>0)){notify('Add a product first.',true);return}
 // Check the server, not a remembered username in frontend state.
 const session=await verifySession();
 if(!session){
  user=null;$('accountLabel').textContent='SIGN IN';
  closeCart();
  if(!await login())return;
 }
 try{
  checkoutStage='saving shopping bag';
  await persistCart();
  checkoutStage='loading delivery addresses';
  let addresses=await request('/api/users/addresses');
  let address=Array.isArray(addresses)&&addresses.length?addresses[0]:null;
  if(!address){
   const fields=[
    {name:'buildingName',label:'BUILDING / HOUSE',placeholder:'House 123',minLength:5},
    {name:'street',label:'STREET',placeholder:'Main Road',minLength:5},
    {name:'city',label:'CITY',placeholder:'Bengaluru'},
    {name:'state',label:'STATE',placeholder:'Karnataka'},
    {name:'country',label:'COUNTRY',placeholder:'India'},
    {name:'pincode',label:'POSTAL CODE',placeholder:'560001',minLength:5}
   ];
   const data=await showDialog('DELIVERY ADDRESS',fields,'SAVE ADDRESS');
   if(!data)return;
   checkoutStage='saving delivery address';
   address=await request('/api/addresses',{method:'POST',body:JSON.stringify(data)});
  }
  const total=Object.entries(cart).reduce((n,[id,q])=>n+(productById(id)?itemPrice(productById(id)):0)*q,0);
  const method=await choosePaymentMethod(total);
  if(!method)return;
  if(method==='STRIPE'){
   checkoutStage='starting Stripe hosted checkout';
   const session=await request('/api/checkout/stripe/session',{method:'POST',
     body:JSON.stringify({addressId:address.addressId})});
   if(!session.url||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))
    throw new Error('Stripe did not provide a valid hosted payment URL');
   window.location.assign(session.url);return;
  }
  const confirm=await showDialog('PLACE ORDER · '+money(total),[{name:'confirmation',label:'TYPE YES TO CONFIRM CASH ON DELIVERY',placeholder:'YES'}],'PLACE ORDER');
  if(!confirm||confirm.confirmation.toUpperCase()!=='YES')return;
  checkoutStage='placing cash-on-delivery order';
  const order=await request('/api/order/users/payments/COD',{method:'POST',body:JSON.stringify({addressId:address.addressId,pgName:'COD',pgPaymentId:null,pgStatus:'PENDING',pgResponseMessage:'Cash on delivery'})});
  cart={};saveGuest();updateCart();closeCart();
  await loadCatalog();
  notify('Order #'+order.orderId+' placed successfully! Payment on delivery.');
  // The order already exists. A failed history refresh must never make the
  // shopper think checkout itself failed or encourage a duplicate purchase.
  await showOrders();
 }catch(e){notify('Checkout failed while '+checkoutStage+': '+e.message,true);console.error('Checkout stage:',checkoutStage,'Error:',e)}
}
function bind(){
 $('year').textContent=new Date().getFullYear();
 $('cartBtn').onclick=openCart;$('closeCart').onclick=closeCart;$('overlay').onclick=closeCart;
 $('accountBtn').onclick=accountAction;$('ordersBtn').onclick=showOrders;$('checkoutBtn').onclick=checkout;
 $('retailerBtn').onclick=retailerAction;$('retailerCta').onclick=retailerAction;$('adminRetailersBtn').onclick=reviewRetailers;
 $('searchGo').onclick=()=>{searchText=$('search').value.trim();applyFilters();$('catalog').scrollIntoView({behavior:'smooth'})};
 $('search').addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(searchDebounce);$('searchGo').click()}});
 $('search').addEventListener('input',()=>{clearTimeout(searchDebounce);searchDebounce=setTimeout(()=>{searchText=$('search').value.trim();applyFilters()},350)});
 $('search').addEventListener('search',()=>{searchText=$('search').value.trim();applyFilters()});
 ['cityFilter','priceFilter','sortFilter'].forEach(id=>$(id).onchange=applyFilters);
 document.querySelectorAll('[data-category-nav]').forEach(el=>el.onclick=()=>setCategory(el.dataset.categoryNav));
 $('clearFilters').onclick=()=>{searchText='';$('search').value='';$('cityFilter').value='';$('priceFilter').value='';setCategory('All')};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCart()});
}
bind();loadCatalog().then(loadSession).then(resumeStripeCheckout);
})();