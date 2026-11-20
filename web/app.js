(() => {
 'use strict';
 const $ = (s) => document.querySelector(s);
 const $$ = (s) => [...document.querySelectorAll(s)];
 const catalog = [
  {key:'original',sku:'COFFEE-ORIGINAL',name:'Original Black',flavor:'ORIGINAL BLACK — COLD BREW',color:'red',image:'assets/can-original.svg',description:'Bold Colombian coffee. Smooth all the way through. Built for whatever the day throws at you.'},
  {key:'vanilla',sku:'COFFEE-VANILLA',name:'Toasted Vanilla',flavor:'TOASTED VANILLA — COLD BREW',color:'blue',image:'assets/can-vanilla.svg',description:'A little sweetness. A lot of character. Your afternoon coffee break just got better.'},
  {key:'mocha',sku:'COFFEE-MOCHA',name:'Smooth Mocha',flavor:'SMOOTH MOCHA — COLD BREW',color:'brown',image:'assets/can-mocha.svg',description:'Rich cocoa notes meet mellow cold brew. Chocolate energy without the heavy finish.'},
  {key:'variety',sku:'COFFEE-VARIETY',name:'Variety Pack',flavor:'ALL THREE FLAVORS',color:'yellow',image:'assets/can-variety.svg',description:'Four of each. Every mood covered.'}
 ];
 const money = x => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(x)||0);
 const hero = $('#home');
 const accountDialog=$('#accountDialog'),searchDialog=$('#searchDialog'),ordersDialog=$('#ordersDialog');
 let active=0, city=localStorage.getItem('nothing-city')||'Bengaluru', access=sessionStorage.getItem('nothing-access')||'', refresh=sessionStorage.getItem('nothing-refresh')||'', currentUser=null;
 let cart={}, productsReady=false, checkoutKey=null, mode='login', working=false;
 const byKey = key => catalog.find(p=>p.key===key);
 const productId = key => byKey(key)?.id;
 const showStatus=(message,error=false)=>{const el=$('#storeStatus');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(showStatus.timer);showStatus.timer=setTimeout(()=>el.hidden=true,6000);};
 async function api(path,options={}) {
   const attempt=async token=>{
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(token) headers.Authorization=`Bearer ${token}`;
    const response=await fetch('/api'+path,{...options,headers,cache:'no-store'});
    let payload=null;try{payload=await response.json();}catch{}
    return {response,payload};
   };
   let {response,payload}=await attempt(access);
   if(response.status===401 && access && refresh && path!='/auth/refresh' && path!='/auth/login') {
    const tokenResponse=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})});
    if(tokenResponse.ok){const tokens=await tokenResponse.json();saveTokens(tokens);({response,payload}=await attempt(access));}
    else {clearTokens();updateAccount();}
   }
   if(!response.ok){let detail=payload?.detail; if(Array.isArray(detail)) detail=detail.map(x=>x.msg).join(', ');throw new Error(typeof detail==='string'?detail:`Request failed (${response.status})`);}
   return payload;
 }
 const saveTokens = t => {access=t.access_token;refresh=t.refresh_token;sessionStorage.setItem('nothing-access',access);sessionStorage.setItem('nothing-refresh',refresh);};
 const clearTokens=()=>{access='';refresh='';currentUser=null;cart={};sessionStorage.removeItem('nothing-access');sessionStorage.removeItem('nothing-refresh');};
 function selectFlavor(index){
  active=(index+3)%3;const p=catalog[active];
  hero.classList.remove('theme-black','theme-vanilla','theme-mocha');hero.classList.add(['theme-black','theme-vanilla','theme-mocha'][active]);
  $('#heroCount').textContent=String(active+1).padStart(2,'0');$('#heroFlavorTag').textContent=p.flavor;$('#heroDescription').textContent=p.description;
  const stage=$('#heroStage');stage.classList.remove('swap');void stage.offsetWidth;$('#heroCan').src=p.image;stage.classList.add('swap');
  $$('.flavor-tab').forEach((el,i)=>{el.classList.toggle('active',i===active);el.setAttribute('aria-selected',String(i===active));});
 }
 $$('.flavor-tab').forEach(button=>button.addEventListener('click',()=>selectFlavor(+button.dataset.flavor)));
 $('#previousFlavor').addEventListener('click',()=>selectFlavor(active-1));$('#nextFlavor').addEventListener('click',()=>selectFlavor(active+1));
 const closeCart=()=>{$('#cartDrawer').classList.remove('open');$('#cartDrawer').setAttribute('aria-hidden','true');$('#drawerOverlay').hidden=true;document.body.classList.remove('locked');};
 const openCart=()=>{$('#drawerOverlay').hidden=false;$('#cartDrawer').classList.add('open');$('#cartDrawer').setAttribute('aria-hidden','false');document.body.classList.add('locked');$('#closeCart').focus({preventScroll:true});};
 $('#cartButton').addEventListener('click',()=>{renderCart();openCart();});$('#closeCart').addEventListener('click',closeCart);$('#drawerOverlay').addEventListener('click',closeCart);
 $('#deliveryCity').value=city;$('#searchCity').value=city;
 function updatePrices(){
  catalog.slice(0,3).forEach(p=>{const e=$(`[data-add="${p.key}"]`)?.closest('.product-card')?.querySelector('.product-price');if(e) e.innerHTML=`${p.price!=null?money(p.price):'UNAVAILABLE'} <span>/ CASE</span>`;});
  const pack=byKey('variety');$('#bundleButton').textContent=`TRY THE VARIETY PACK — ${pack.price!=null?money(pack.price):'UNAVAILABLE'} ↗`;
  $$('[data-add],#heroAdd,#bundleButton').forEach(btn=>{const key=btn.dataset.add|| (btn.id==='bundleButton'?'variety':catalog[active].key);btn.disabled=!productId(key);});
 }
 async function loadCatalog(){
  try{const data=await api('/products?size=100');for(const p of catalog){const matched=data.items.find(v=>v.sku===p.sku);p.id=matched?.id;p.price=matched?.price;}productsReady=true;updatePrices();await refreshStock();}
  catch(err){showStatus(`Product service unavailable: ${err.message}`,true);}
 }
 async function refreshStock(){
  const details=await Promise.all(catalog.filter(p=>p.id).map(async p=>{try{return [p.key,await api('/products/'+encodeURIComponent(p.id))];}catch{return [p.key,null];}}));
  for(const [key,detail] of details){const p=byKey(key);p.stock=detail?.inventory||{};}
  renderCart();updatePrices();
 }
 async function loadCart(){
  if(!access){cart={};renderCart();return;}
  const data=await api('/cart');cart={};for(const row of data.items){const item=catalog.find(p=>p.id===row.product_id);if(item&&row.city===city)cart[item.key]=row.quantity;}renderCart();
 }
 function renderCart(){
  const entries=catalog.filter(p=>cart[p.key]);const count=entries.reduce((n,p)=>n+cart[p.key],0);$('#cartCount').textContent=`(${count})`;
  $('#subtotal').textContent=money(entries.reduce((n,p)=>n+Number(p.price||0)*cart[p.key],0));
  $('#cartItems').replaceChildren();
  if(!count){const empty=document.createElement('div');empty.className='empty-cart';empty.textContent='YOUR CART IS ON A COFFEE BREAK.';const small=document.createElement('small');small.textContent=access?'Pick a flavor to get moving.':'Sign in to save your cart and place an order.';empty.append(small);$('#cartItems').append(empty);return;}
  for(const p of entries){const item=document.createElement('article');item.className='cart-item';
   const thumb=document.createElement('div');thumb.className=`cart-thumb ${p.color}`;const img=document.createElement('img');img.src=p.image;img.alt=p.name;thumb.append(img);
   const info=document.createElement('div');info.className='cart-item-info';const inside=document.createElement('div');const h=document.createElement('h3');h.textContent=p.name.toUpperCase();const label=document.createElement('p');label.textContent=`12 PACK · ${city} · ${p.stock?.[city]??'?'} in stock`;
   const ctr=document.createElement('div');ctr.className='quantity-controls';for(const delta of [-1,1]){const btn=document.createElement('button');btn.textContent=delta===-1?'−':'+';btn.setAttribute('aria-label',`${delta===-1?'Remove':'Add'} one ${p.name}`);btn.onclick=()=>setQuantity(p.key,cart[p.key]+delta);ctr.append(btn);if(delta===-1){const q=document.createElement('span');q.textContent=cart[p.key];ctr.append(q);}}
   inside.append(h,label,ctr);const price=document.createElement('div');price.className='cart-price';price.textContent=money(Number(p.price)*cart[p.key]);info.append(inside,price);item.append(thumb,info);$('#cartItems').append(item);
  }
 }
 async function setQuantity(key,qty){
  const p=byKey(key);if(!p?.id)return showStatus('Product is unavailable.',true);
  if(!access){closeCart();accountDialog.showModal();return showStatus('Please sign in to add coffee to your cart.');}
  if(working)return;working=true;
  try{
   if(qty>100)throw new Error('Maximum 100 cases per product');
   if(qty>Number(p.stock?.[city]??0))throw new Error(`Only ${p.stock?.[city]??0} cases available in ${city}`);
   if(qty<=0)await api(`/cart/items/${encodeURIComponent(p.id)}?city=${encodeURIComponent(city)}`,{method:'DELETE'});
   else await api('/cart/items',{method:'POST',body:JSON.stringify({product_id:p.id,city,quantity:qty})});
   checkoutKey=null;await loadCart();
  }catch(err){showStatus(err.message,true);}finally{working=false;}
 }
 async function addToCart(key){if(!productsReady){showStatus('Catalog is still loading.',true);return;}await setQuantity(key,(cart[key]||0)+1);if(access)openCart();}
 $('#heroAdd').addEventListener('click',()=>addToCart(catalog[active].key));$$('[data-add]').forEach(button=>button.addEventListener('click',()=>addToCart(button.dataset.add)));$('#bundleButton').addEventListener('click',()=>addToCart('variety'));
 $('#deliveryCity').addEventListener('change',async e=>{city=e.target.value;localStorage.setItem('nothing-city',city);$('#searchCity').value=city;checkoutKey=null;try{await loadCart();await refreshStock();}catch(err){showStatus(err.message,true);}});
 $('#checkoutButton').addEventListener('click',async()=>{
  if(working)return;if(!access){closeCart();accountDialog.showModal();return showStatus('Sign in before checkout.');}
  if(!Object.keys(cart).length)return showStatus('Your cart is empty.',true);
  if(!confirm(`Place your order for ${$('#subtotal').textContent} in ${city}? This places an unpaid order and reserves inventory. No payment will be collected.`))return;
  working=true;$('#checkoutButton').disabled=true;
  if(!checkoutKey)checkoutKey=(globalThis.crypto?.randomUUID?.()||`order-${Date.now()}-${Math.random()}`);
  try{const order=await api('/orders/checkout',{method:'POST',headers:{'Idempotency-Key':checkoutKey},body:JSON.stringify({city})});checkoutKey=null;await loadCart();await refreshStock();closeCart();showStatus(`Order ${order.id.slice(0,8)} placed. Total: ${money(order.total)}. Payment not collected.`);}
  catch(err){showStatus(`Checkout failed: ${err.message}`,true);}
  finally{working=false;$('#checkoutButton').disabled=false;}
 });
 function updateAccount(){const signed=Boolean(access&&currentUser);$('#accountBtn').textContent=signed?'MY ACCOUNT':'ACCOUNT';$('#accountGuest').hidden=signed;$('#accountSigned').hidden=!signed;$('#signedEmail').textContent=currentUser?.email||'';$('#accountTitle').textContent=signed?'YOUR ACCOUNT.':mode==='login'?'WELCOME BACK.':'JOIN THE CLUB.';$('#accountSubmit').textContent=mode==='login'?'SIGN IN ↗':'CREATE ACCOUNT ↗';$('#accountMode').textContent=mode==='login'?'NEW HERE? CREATE AN ACCOUNT':'ALREADY HAVE AN ACCOUNT? SIGN IN';}
 $('#accountBtn').addEventListener('click',()=>{updateAccount();accountDialog.showModal();});$('#accountClose').onclick=()=>accountDialog.close();
 $('#accountMode').onclick=()=>{mode=mode==='login'?'register':'login';$('#accountPassword').autocomplete=mode==='login'?'current-password':'new-password';$('#accountFeedback').textContent='';updateAccount();};
 $('#accountForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('#accountEmail').value.trim(),password=$('#accountPassword').value;$('#accountFeedback').textContent='CONNECTING…';$('#accountSubmit').disabled=true;
  try{if(mode==='register')await api('/auth/register',{method:'POST',body:JSON.stringify({email,password})});const tokens=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});saveTokens(tokens);currentUser=await api('/auth/me');await loadCart();updateAccount();accountDialog.close();showStatus(`Welcome, ${email}.`);}
  catch(err){$('#accountFeedback').textContent=err.message;}finally{$('#accountSubmit').disabled=false;}
 });
 $('#signOut').onclick=async()=>{try{if(refresh)await api('/auth/logout',{method:'POST',body:JSON.stringify({refresh_token:refresh})});}catch{}clearTokens();renderCart();updateAccount();accountDialog.close();showStatus('Signed out.');};
 $('#myOrders').onclick=async()=>{accountDialog.close();ordersDialog.showModal();$('#orderHistory').textContent='Loading orders…';try{const data=await api('/orders');$('#orderHistory').replaceChildren();if(!data.items.length){$('#orderHistory').textContent='No orders yet.';return;}for(const order of data.items){const el=document.createElement('div');el.className='history-entry';const h=document.createElement('strong');h.textContent=`${order.status.toUpperCase()} · ${money(order.total)}`;const p=document.createElement('p');p.textContent=`#${order.id.slice(0,8)} · ${order.city} · ${new Date(order.created_at).toLocaleDateString('en-IN')}`;const items=document.createElement('p');items.textContent=order.items.map(i=>`${i.name} × ${i.quantity}`).join(', ');el.append(h,p,items);$('#orderHistory').append(el);}}catch(err){$('#orderHistory').textContent=err.message;}};
 $('#ordersClose').onclick=()=>ordersDialog.close();
 $('#searchBtn').onclick=()=>{searchDialog.showModal();$('#searchQuery').focus();};$('#searchClose').onclick=()=>searchDialog.close();
 $('#searchForm').addEventListener('submit',async e=>{e.preventDefault();const query=$('#searchQuery').value.trim(),c=$('#searchCity').value;$('#searchResults').textContent='Searching OpenSearch…';try{
  const data=await api(`/search?q=${encodeURIComponent(query)}&city=${encodeURIComponent(c)}&category=Coffee`);$('#searchResults').replaceChildren();if(!data.items.length){$('#searchResults').textContent='No matching coffee found in that city.';return;}
  for(const result of data.items){const p=catalog.find(x=>x.id===result.id);const row=document.createElement('div');row.className='search-result';const strong=document.createElement('strong');strong.textContent=result.name;const details=document.createElement('p');details.textContent=`${money(result.price)} · ${c}`;row.append(strong,details);if(p){const btn=document.createElement('button');btn.textContent='ADD TO CART ↗';btn.onclick=async()=>{searchDialog.close();if(city!==c){city=c;$('#deliveryCity').value=city;localStorage.setItem('nothing-city',city);await loadCart();await refreshStock();}await addToCart(p.key);};row.append(btn);}$('#searchResults').append(row);}
 }catch(err){$('#searchResults').textContent=`Search unavailable: ${err.message}`;}});
 const info=$('#infoDialog');const showInfo=(title,message)=>{closeCart();$('#dialogTitle').textContent=title;$('#dialogText').textContent=message;info.showModal();};$('#dialogClose').onclick=()=>info.close();
 $('#teamButton').onclick=()=>showInfo('BUSINESS INQUIRIES.','This deployment does not send team inquiries yet. Configure a verified support mailbox or CRM before taking requests.');
 $('#footerContact').onclick=()=>showInfo('SAY HELLO.','Please configure your verified customer-service contact details before launching this store.');
 $('#newsletterForm').addEventListener('submit',async e=>{e.preventDefault();$('#newsletterFeedback').textContent='SUBMITTING…';try{await api('/newsletter',{method:'POST',body:JSON.stringify({email:$('#emailInput').value})});$('#newsletterFeedback').textContent='YOU ARE ON THE LIST.';$('#newsletterForm').reset();}catch(err){$('#newsletterFeedback').textContent=`SIGNUP FAILED: ${err.message}`;}});
 $('#year').textContent=new Date().getFullYear();const updateHeader=()=>$('#siteHeader').classList.toggle('scrolled',window.scrollY>65);window.addEventListener('scroll',updateHeader,{passive:true});updateHeader();
 const mobileButton=$('#mobileMenuButton'),mobileMenu=$('#mobileMenu');const closeMobile=()=>{mobileMenu.hidden=true;mobileButton.setAttribute('aria-expanded','false');};mobileButton.onclick=()=>{const open=mobileMenu.hidden;mobileMenu.hidden=!open;mobileButton.setAttribute('aria-expanded',String(open));};$$('#mobileMenu a').forEach(el=>el.addEventListener('click',closeMobile));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCart();closeMobile();}if(document.activeElement.closest?.('.hero-selector')&&e.key==='ArrowRight')selectFlavor(active+1);if(document.activeElement.closest?.('.hero-selector')&&e.key==='ArrowLeft')selectFlavor(active-1);});
 hero.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;$('#heroStage').style.translate=`${(e.clientX/window.innerWidth-.5)*12}px ${(e.clientY/window.innerHeight-.5)*9}px`;});hero.addEventListener('pointerleave',()=>{$('#heroStage').style.translate='0 0';});
 let startX=null;hero.addEventListener('touchstart',e=>startX=e.changedTouches[0]?.clientX??null,{passive:true});hero.addEventListener('touchend',e=>{if(startX===null)return;const diff=e.changedTouches[0].clientX-startX;if(Math.abs(diff)>70)selectFlavor(active+(diff<0?1:-1));startX=null;},{passive:true});
 if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.11});$$('.reveal').forEach(el=>observer.observe(el));}else $$('.reveal').forEach(el=>el.classList.add('visible'));
 const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduce)$('#loader').classList.add('done');else{const started=performance.now(),duration=1050;function frame(now){const fraction=Math.min(1,(now-started)/duration),progress=Math.round((1-(1-fraction)**2)*100);$('#loaderPercent').textContent=`${progress}%`;$('#loaderFill').style.width=`${progress}%`;if(fraction<1)requestAnimationFrame(frame);else setTimeout(()=>$('#loader').classList.add('done'),180);}requestAnimationFrame(frame);}
 async function init(){updateAccount();renderCart();await loadCatalog();if(access){try{currentUser=await api('/auth/me');await loadCart();updateAccount();}catch{clearTokens();updateAccount();renderCart();}}}
 init();
})();
