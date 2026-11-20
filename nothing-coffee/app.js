(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const products = [
    {id:'original', name:'Original Black', flavor:'ORIGINAL BLACK — COLD BREW', price:45.99, color:'red', image:'assets/can-original.svg', description:'Bold Colombian coffee. Smooth all the way through. Built for whatever the day throws at you.'},
    {id:'vanilla', name:'Toasted Vanilla', flavor:'TOASTED VANILLA — COLD BREW', price:45.99, color:'blue', image:'assets/can-vanilla.svg', description:'A little sweetness. A lot of character. Your afternoon coffee break just got better.'},
    {id:'mocha', name:'Smooth Mocha', flavor:'SMOOTH MOCHA — COLD BREW', price:45.99, color:'brown', image:'assets/can-mocha.svg', description:'Rich cocoa notes meet mellow cold brew. Chocolate energy without the heavy finish.'},
    {id:'variety', name:'Variety Pack', flavor:'ALL THREE FLAVORS', price:47.99, color:'yellow', image:'assets/can-variety.svg', description:'Four of each. Every mood covered.'}
  ];
  const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  let active = 0;
  let cart = {};
  try { const stored = JSON.parse(localStorage.getItem('nothing-demo-cart') || '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) cart = stored; } catch { cart = {}; }
  const hero = $('#home');
  function selectFlavor(index) {
    active = (index + 3) % 3;
    const product = products[active];
    hero.classList.remove('theme-black','theme-vanilla','theme-mocha');
    hero.classList.add(['theme-black','theme-vanilla','theme-mocha'][active]);
    $('#heroCount').textContent = String(active+1).padStart(2,'0');
    $('#heroFlavorTag').textContent = product.flavor;
    $('#heroDescription').textContent = product.description;
    const stage = $('#heroStage');
    stage.classList.remove('swap');
    void stage.offsetWidth;
    $('#heroCan').src = product.image;
    stage.classList.add('swap');
    $$('.flavor-tab').forEach((el,i)=> { el.classList.toggle('active',i===active);el.setAttribute('aria-selected',String(i===active)); });
  }
  $$('.flavor-tab').forEach(button => button.addEventListener('click',()=>selectFlavor(+button.dataset.flavor)));
  $('#previousFlavor').addEventListener('click',()=>selectFlavor(active-1));
  $('#nextFlavor').addEventListener('click',()=>selectFlavor(active+1));
  $('#heroAdd').addEventListener('click',()=>addToCart(products[active].id));
  $$('[data-add]').forEach(button=>button.addEventListener('click',()=>addToCart(button.dataset.add)));
  $('#bundleButton').addEventListener('click',()=>addToCart('variety'));
  let startX = null;
  hero.addEventListener('touchstart',event=>{startX=event.changedTouches[0]?.clientX??null;},{passive:true});
  hero.addEventListener('touchend',event=>{if(startX===null)return;const diff=event.changedTouches[0].clientX-startX;if(Math.abs(diff)>70)selectFlavor(active+(diff<0?1:-1));startX=null;},{passive:true});
  hero.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const x=(event.clientX/window.innerWidth-.5)*12;
    const y=(event.clientY/window.innerHeight-.5)*9;
    $('#heroStage').style.translate=`${x}px ${y}px`;
  });
  hero.addEventListener('pointerleave',()=>{$('#heroStage').style.translate='0 0';});
  function normalizeCart(){Object.entries(cart).forEach(([id,qty])=>{if(!products.some(p=>p.id===id)||!Number.isFinite(Number(qty))||Number(qty)<=0) delete cart[id];else cart[id]=Math.min(99,Math.floor(Number(qty)));});}
  function persistCart(){normalizeCart();try{localStorage.setItem('nothing-demo-cart',JSON.stringify(cart));}catch{}renderCart();}
  function addToCart(id){if(!products.some(p=>p.id===id))return;cart[id]=(cart[id]||0)+1;persistCart();openCart();}
  function renderCart(){
    const count=Object.values(cart).reduce((sum,quantity)=>sum+quantity,0);
    $('#cartCount').textContent=`(${count})`;
    $('#subtotal').textContent=money(Object.entries(cart).reduce((sum,[id,qty])=>sum+(products.find(p=>p.id===id)?.price||0)*qty,0));
    if(!count){$('#cartItems').innerHTML='<div class="empty-cart">YOUR CART IS<br>ON A COFFEE BREAK.<small>Pick a flavor to get things moving.</small></div>';return;}
    $('#cartItems').innerHTML=products.filter(p=>cart[p.id]).map(p=>`<article class="cart-item"><div class="cart-thumb ${p.color}"><img src="${p.image}" alt=""></div><div class="cart-item-info"><div><h3>${p.name.toUpperCase()}</h3><p>12 PACK · 335ML</p><div class="quantity-controls"><button data-qty="${p.id}" data-delta="-1" aria-label="Remove one ${p.name}">−</button><span>${cart[p.id]}</span><button data-qty="${p.id}" data-delta="1" aria-label="Add one ${p.name}">+</button></div></div><div class="cart-price">${money(p.price*cart[p.id])}</div></div></article>`).join('');
    $$('[data-qty]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.qty;cart[id]=(cart[id]||0)+Number(button.dataset.delta);persistCart();}));
  }
  function openCart(){ $('#drawerOverlay').hidden=false;$('#cartDrawer').classList.add('open');$('#cartDrawer').setAttribute('aria-hidden','false');document.body.classList.add('locked');$('#closeCart').focus({preventScroll:true}); }
  function closeCart(){ $('#cartDrawer').classList.remove('open');$('#cartDrawer').setAttribute('aria-hidden','true');$('#drawerOverlay').hidden=true;document.body.classList.remove('locked'); }
  $('#cartButton').addEventListener('click',openCart);
  $('#closeCart').addEventListener('click',closeCart);
  $('#drawerOverlay').addEventListener('click',closeCart);
  const dialog = $('#infoDialog');
  function showInfo(title,text){closeCart();$('#dialogTitle').textContent=title;$('#dialogText').textContent=text;dialog.showModal();}
  $('#dialogClose').addEventListener('click',()=>dialog.close());
  $('#checkoutButton').addEventListener('click',()=>showInfo('DEMO CHECKOUT.','The cart is working, but this is a front-end prototype. Connect Shopify, Stripe, WooCommerce, or another ecommerce backend to accept real orders.'));
  $('#accountBtn').addEventListener('click',()=>showInfo('ACCOUNT ACCESS.','Account authentication is not configured in this concept. Connect your customer platform before making the site live.'));
  $('#teamButton').addEventListener('click',()=>showInfo('LET’S TALK COFFEE.','The teams inquiry feature is a design preview. Add your real business email or CRM endpoint to collect inquiries.'));
  $('#footerContact').addEventListener('click',()=>showInfo('SAY HELLO.','Add your verified business contact email and customer-service workflow here before publishing.'));
  $('#newsletterForm').addEventListener('submit',event=>{event.preventDefault();$('#newsletterFeedback').textContent='LOOKING GOOD. THIS DEMO DOES NOT STORE OR SEND EMAILS.';$('#newsletterForm').reset();});
  $('#year').textContent=new Date().getFullYear();
  function updateHeader(){ $('#siteHeader').classList.toggle('scrolled',window.scrollY>65); }
  window.addEventListener('scroll',updateHeader,{passive:true});updateHeader();
  const mobileButton=$('#mobileMenuButton'),mobileMenu=$('#mobileMenu');
  function closeMobile(){mobileMenu.hidden=true;mobileButton.setAttribute('aria-expanded','false');}
  mobileButton.addEventListener('click',()=>{const open=mobileMenu.hidden;mobileMenu.hidden=!open;mobileButton.setAttribute('aria-expanded',String(open));});
  $$('#mobileMenu a').forEach(a=>a.addEventListener('click',closeMobile));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeCart();closeMobile();if(dialog.open)dialog.close();}if(document.activeElement.closest?.('.hero-selector')&&event.key==='ArrowRight')selectFlavor(active+1);if(document.activeElement.closest?.('.hero-selector')&&event.key==='ArrowLeft')selectFlavor(active-1);});
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}})},{threshold:.11});$$('.reveal').forEach(el=>observer.observe(el));}else{$$('.reveal').forEach(el=>el.classList.add('visible'));}
  renderCart();
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){$('#loader').classList.add('done');}else{
    const started=performance.now();const duration=1050;
    function loadFrame(now){const fraction=Math.min(1,(now-started)/duration);const progress=Math.round((1-Math.pow(1-fraction,2))*100);$('#loaderPercent').textContent=`${progress}%`;$('#loaderFill').style.width=`${progress}%`;if(fraction<1)requestAnimationFrame(loadFrame);else setTimeout(()=>$('#loader').classList.add('done'),180);}
    requestAnimationFrame(loadFrame);
  }
})();
