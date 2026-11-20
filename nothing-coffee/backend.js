(() => {
  "use strict";
  const API = (window.NOTHING_API_BASE || "http://localhost:8080").replace(/\/$/, "");
  const names = {original:"Original Black",vanilla:"Toasted Vanilla",mocha:"Smooth Mocha",variety:"Variety Pack"};
  const ids = {};
  let connected = false;
  const rupees = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(n));
  async function api(path,options={}) {
    const response = await fetch(API+path,{
      ...options,credentials:"include",
      headers:{"Content-Type":"application/json",...(options.headers||{})}
    });
    const text = await response.text();
    let body;
    try{body=JSON.parse(text);}catch{body=text;}
    if(!response.ok){
      const message=typeof body==="object" && body ? (body.message||body.error) : body;
      throw new Error(message||("Request failed: "+response.status));
    }
    return body;
  }
  const notice=document.createElement("div");
  notice.setAttribute("role","status");
  notice.style.cssText="position:fixed;left:12px;bottom:12px;z-index:10005;background:#121212;color:white;border-radius:8px;padding:10px 14px;font:12px system-ui;box-shadow:0 2px 16px #0003;max-width:300px";
  notice.textContent="Connecting to Nothing inventory…";
  document.body.appendChild(notice);
  function status(message,ok){notice.textContent=message;notice.style.background=ok?"#155e46":"#622e29";}
  async function refreshCatalog(){
    try{
      const page=await api("/api/public/products?pageSize=100");
      const catalog=Array.isArray(page.products)?page.products:[];
      let count=0;
      for(const product of window.NothingCatalog||[]){
        const match=catalog.find(p=>String(p.productName||p.ProductName||"").toLowerCase()===names[product.id].toLowerCase());
        if(!match)continue;
        ids[product.id]=Number(match.productId??match.ProductId);
        product.price=Number(match.specialPrice??match.price);
        product.stock=Number(match.quantity||0);
        count++;
      }
      connected=true;
      document.querySelectorAll(".product-card").forEach((card,i)=>{
        const product=(window.NothingCatalog||[])[i];
        if(!product)return;
        const label=card.querySelector(".product-price");
        if(label && ids[product.id])label.innerHTML=rupees(product.price)+" <span>/ CASE</span>";
      });
      window.dispatchEvent(new Event("nothing:catalog"));
      status(count===4?"LIVE INVENTORY CONNECTED":"Backend connected. "+count+"/4 coffee products available.",count===4);
    }catch(e){connected=false;status("Backend offline: checkout unavailable",false);}
  }
  const dialog=document.createElement("dialog");
  dialog.setAttribute("aria-label","Nothing account and checkout");
  dialog.style.cssText="max-width:440px;width:calc(100% - 36px);border:0;border-radius:14px;padding:24px;color:#171717;background:#faf8f2;box-shadow:0 16px 80px #0005";
  document.body.appendChild(dialog);
  function ask(title,fields,action){
    return new Promise(resolve=>{
      dialog.replaceChildren();
      const heading=document.createElement("h2");heading.textContent=title;heading.style.margin="0 0 14px";dialog.appendChild(heading);
      const form=document.createElement("form");form.style.cssText="display:grid;gap:10px";
      const inputs={};
      fields.forEach(f=>{
        const label=document.createElement("label");label.style.cssText="display:grid;gap:4px;font:13px system-ui";label.textContent=f.label;
        const input=document.createElement("input");input.name=f.name;input.type=f.type||"text";input.required=true;
        input.autocomplete=f.autocomplete||"off";input.placeholder=f.placeholder||"";
        input.style.cssText="padding:12px;border:1px solid #bbb;border-radius:7px;background:white;color:#151515";
        label.appendChild(input);form.appendChild(label);inputs[f.name]=input;
      });
      const error=document.createElement("p");error.style.cssText="color:#b42318;font:13px system-ui";error.setAttribute("role","alert");
      form.appendChild(error);
      const row=document.createElement("div");row.style.cssText="display:flex;gap:10px;justify-content:end";
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancel";
      const submit=document.createElement("button");submit.type="submit";submit.textContent=action||"Continue";
      for(const b of [cancel,submit])b.style.cssText="padding:10px 16px;border-radius:8px;border:1px solid #bbb;cursor:pointer";
      row.append(cancel,submit);form.appendChild(row);dialog.appendChild(form);
      let finished=false;
      function finish(value){if(finished)return;finished=true;dialog.close();resolve(value);}
      cancel.onclick=()=>finish(null);
      dialog.oncancel=e=>{e.preventDefault();finish(null);};
      form.onsubmit=e=>{e.preventDefault();const values={};for(const [key,input] of Object.entries(inputs))values[key]=input.value.trim();finish(values);};
      dialog.showModal();
      Object.values(inputs)[0]?.focus();
    });
  }
  function show(message){
    status(message,false);
    window.alert(message);
  }
  async function account(){
    try{
      const existing=await api("/api/auth/username");
      if(typeof existing==="string" && existing.trim()) {window.alert("Signed in as "+existing);return true;}
    }catch{}
    const mode=await ask("NOTHING ACCOUNT",[{name:"mode",label:"Type LOGIN or SIGNUP",placeholder:"LOGIN"}],"Next");
    if(!mode)return false;
    const signup=mode.mode.toUpperCase()==="SIGNUP";
    const fields=[{name:"username",label:"Username",autocomplete:"username"}];
    if(signup)fields.push({name:"email",label:"Email",type:"email",autocomplete:"email"});
    fields.push({name:"password",label:"Password",type:"password",autocomplete:signup?"new-password":"current-password"});
    const values=await ask(signup?"CREATE ACCOUNT":"SIGN IN",fields,signup?"Sign up":"Sign in");
    if(!values)return false;
    try{
      if(signup)await api("/api/auth/signup",{method:"POST",body:JSON.stringify(values)});
      await api("/api/auth/signin",{method:"POST",body:JSON.stringify({username:values.username,password:values.password})});
      status("Signed in. Checkout is available.",true);
      return true;
    }catch(e){show("Account request failed: "+e.message);return false;}
  }
  async function checkout(cart){
    if(!connected){show("Start the backend and connect the product catalog before checkout.");return;}
    const items=Object.entries(cart).filter(([,qty])=>Number(qty)>0);
    if(!items.length){show("Your cart is empty.");return;}
    for(const [key,qty] of items){
      const product=(window.NothingCatalog||[]).find(p=>p.id===key);
      if(!ids[key]){show("Product "+names[key]+" is not in the backend catalog.");return;}
      if(product && Number(qty)>product.stock){show("Insufficient stock for "+names[key]);return;}
    }
    try{
      let current=await api("/api/auth/username");
      if(!current){if(!await account())return;}
      await api("/api/cart/create",{method:"POST",body:JSON.stringify(items.map(([key,qty])=>({productId:ids[key],quantity:Number(qty)})))});
      const addresses=await api("/api/users/addresses");
      let addressId=Array.isArray(addresses)&&addresses.length?addresses[0].addressId:null;
      if(!addressId){
        const fields=["street","buildingName","city","state","country","pincode"].map(k=>({name:k,label:k.replace(/([A-Z])/g," $1")}));
        const address=await ask("DELIVERY ADDRESS",fields,"Save address");
        if(!address)return;
        const result=await api("/api/addresses",{method:"POST",body:JSON.stringify(address)});
        addressId=result.addressId;
      }
      const order=await api("/api/order/users/payments/COD",{method:"POST",
        body:JSON.stringify({addressId,paymentMethod:"COD",pgName:"COD",pgPaymentId:null,pgStatus:"PENDING",pgResponseMessage:"Cash on delivery"})});
      window.alert("Order placed successfully! Order #"+order.orderId+". Payment: cash on delivery.");
      localStorage.removeItem("nothing-demo-cart");
      location.reload();
    }catch(e){show("Checkout failed: "+e.message);}
  }
  window.NothingBackend={api,account,checkout,refreshCatalog};
  refreshCatalog();
})();