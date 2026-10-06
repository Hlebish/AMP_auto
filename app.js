const ampFirebaseConfig={apiKey:"AIzaSyD_e0H_aH25JnpULvyEwUSSeZoOAxJVBt8",authDomain:"amp-auto.firebaseapp.com",projectId:"amp-auto",storageBucket:"amp-auto.firebasestorage.app",messagingSenderId:"305575986701",appId:"1:305575986701:web:424e1d1e14a2855274f744"};
const $=s=>document.querySelector(s), norm=v=>String(v??"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-яіїєґ0-9]+/g," ").trim();
const compact=v=>norm(v).replace(/\s+/g,"");
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let catalog=[],results=[],mode="parts";

const aliases={
 "bmw":["bmw","бмв","бмв"],
 "audi":["audi","ауди","ауді"],
 "mercedes":["mercedes","мерседес","mb"],
 "volkswagen":["volkswagen","фольксваген","vw"],
 "toyota":["toyota","тойота"],
 "honda":["honda","хонда"],
 "mazda":["mazda","мазда"],
 "ford":["ford","форд"],
 "nissan":["nissan","ниссан","ніссан"],
 "renault":["renault","рено"],
 "skoda":["skoda","шкода"],
 "hyundai":["hyundai","хендай","хюндай"],
 "kia":["kia","киа","кіа"],
 "mitsubishi":["mitsubishi","митсубиси","мітсубісі"],
 "opel":["opel","опель"],
 "peugeot":["peugeot","пежо"],
 "citroen":["citroen","ситроен","сітроен"]
};
function expandedToken(t){
 const x=norm(t), out=new Set([x]);
 for(const arr of Object.values(aliases))if(arr.includes(x))arr.forEach(v=>out.add(norm(v)));
 return [...out];
}
function isCode(q){return /^(?=.*[a-z])(?=.*\d)[a-z0-9]{4,}$/i.test(compact(q))}
function exactCodeMatch(q,text){const a=compact(q),b=compact(text);return !!a&&b.includes(a)}
function tokenMatch(t,text){
 const n=norm(text), c=compact(text);
 if(isCode(t))return exactCodeMatch(t,text);
 return expandedToken(t).some(x=>n.includes(x)||c.includes(compact(x)));
}
function scoreItem(item,q){
 const tokens=norm(q).split(/\s+/).filter(Boolean);
 if(!tokens.length)return 0;
 const fields=[item.a,item.n,item.o,item.b,item.m,item.e,item.v];
 if(isCode(q))return fields.some(f=>exactCodeMatch(q,f))?10000:0;
 let score=0;
 for(const t of tokens){
   if(fields.some(f=>tokenMatch(t,f)))score+=1;
   else return 0;
 }
 const cq=compact(q);
 if(compact(item.a)===cq)score+=20;
 if(compact(item.o).split(",").some(x=>x===cq))score+=15;
 if(norm(item.b).split(",").map(x=>x.trim()).includes(norm(q)))score+=10;
 return score;
}
function qtyValue(q){if(String(q).trim()==="5+")return 5;const n=Number(q);return Number.isFinite(n)?n:0}
function stockOnly(rows){
 return rows.filter(r=>r.catalog_number&&qtyValue(r.quantity)>0);
}
function parseExcel(file){
 return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
      resolve(stockOnly(rows));
    }catch(err){reject(err)}
   };
   reader.onerror=reject;reader.readAsArrayBuffer(file);
 });
}
function saveCatalog(){try{localStorage.setItem("amp_auto_catalog",JSON.stringify(catalog))}catch(e){console.warn("Catalog local save failed",e)}}
function loadCatalog(){try{const x=JSON.parse(localStorage.getItem("amp_auto_catalog")||"[]");if(Array.isArray(x))catalog=x}catch(e){}}
function saveCatalogVersion(v){try{localStorage.setItem("amp_auto_catalog_version",String(v))}catch(e){}}
function loadCatalogVersion(){try{return localStorage.getItem("amp_auto_catalog_version")||""}catch(e){return ""}}
function arrayBufferFromResponse(r){return r.arrayBuffer()}
async function downloadCatalogFromStorage(){
  try{
    const ref=ampStorage.ref("catalog/products.xlsx");
    const meta=await ref.getMetadata();
    const version=String(meta.updated||meta.generation||"");
    const localVersion=loadCatalogVersion();
    if(localVersion===version && catalog.length){
      toast("Каталог актуален");
      return true;
    }
    const url=await ref.getDownloadURL();
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const buffer=await arrayBufferFromResponse(response);
    const wb=XLSX.read(buffer,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
    catalog=stockOnly(rows);
    saveCatalog();
    saveCatalogVersion(version);
    initStats();populateBrands();render(catalog.slice(0,100),"Каталог склада");
    toast("Каталог обновлён: "+catalog.length+" артикулов");
    return true;
  }catch(e){
    console.warn("Storage catalog unavailable:",e);
    if(catalog.length){
      initStats();populateBrands();render(catalog.slice(0,100),"Каталог склада");
      toast("Используется последний сохранённый каталог");
    }else{
      toast("Каталог ещё не загружен");
    }
    return false;
  }
}
async function uploadCatalogToStorage(file){
  const ref=ampStorage.ref("catalog/products.xlsx");
  await ref.put(file,{contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",cacheControl:"no-cache"});
  return downloadCatalogFromStorage();
}
function initStats(){
 const brands=new Set();
 catalog.forEach(x=>String(x.marks||"").split(",").map(v=>v.trim()).filter(Boolean).forEach(v=>brands.add(v.toLowerCase())));
 $("#stockCount").textContent=catalog.length.toLocaleString("ru-RU");
 $("#brandCount").textContent=brands.size;
}
function populateBrands(){
 const set=new Set();
 catalog.forEach(x=>String(x.marks||"").split(",").map(v=>v.trim()).filter(Boolean).forEach(v=>set.add(v)));
 const el=$("#brand");el.innerHTML='<option value="">Марка</option>'+[...set].sort((a,b)=>a.localeCompare(b)).map(v=>'<option>'+escapeHtml(v)+'</option>').join("");
}
function populateModels(){
 const b=norm($("#brand").value),set=new Set();
 catalog.filter(x=>!b||norm(x.marks).split(",").map(v=>v.trim()).includes(b)).forEach(x=>String(x.models||"").split(",").map(v=>v.trim()).filter(Boolean).forEach(v=>set.add(v)));
 $("#model").innerHTML='<option value="">Модель</option>'+[...set].sort((a,b)=>a.localeCompare(b)).slice(0,500).map(v=>'<option>'+escapeHtml(v)+'</option>').join("");
 $("#engine").innerHTML='<option value="">Двигатель</option>';
}
function populateEngines(){
 const b=norm($("#brand").value),m=norm($("#model").value),set=new Set();
 catalog.filter(x=>(!b||norm(x.marks).split(",").map(v=>v.trim()).includes(b))&&(!m||norm(x.models).split(",").map(v=>v.trim()).includes(m))).forEach(x=>String(x.engine||"").split(",").map(v=>v.trim()).filter(Boolean).forEach(v=>set.add(v)));
 $("#engine").innerHTML='<option value="">Двигатель</option>'+[...set].sort((a,b)=>a.localeCompare(b)).slice(0,500).map(v=>'<option>'+escapeHtml(v)+'</option>').join("");
}
function render(list,title="Каталог склада"){
 results=list.slice(0,300);$("#resultTitle").textContent=title+(list.length>300?" · первые 300":"");
 if(!list.length){$("#results").innerHTML='<div class="empty">Ничего не найдено среди деталей, которые есть в наличии.</div>';return}
 $("#results").innerHTML=list.slice(0,300).map(x=>{
   const qty=String(x.quantity||"");
   return '<article class="result-card"><div><div class="result-name">'+escapeHtml(x.name||x.catalog_number)+'</div><div class="meta"><strong>'+escapeHtml(x.catalog_number)+'</strong> · '+escapeHtml(x.manufacturer_parts||"")+'<br>OEM: '+escapeHtml(String(x.original_number||"").split(",").slice(0,6).join(", "))+'<br>Авто: '+escapeHtml(x.marks||"")+(x.models?" · "+escapeHtml(String(x.models).split(",").slice(0,3).join(", ")):"")+'<br><span class="qty">В наличии: '+escapeHtml(qty)+'</span>'+(x.price?' · '+Number(x.price).toLocaleString("uk-UA")+' ₴':"")+'</div></div></article>';
 }).join("");
}
function searchParts(q){
 if(!q.trim()){render(catalog.slice(0,100),"Каталог склада");return}
 const scored=catalog.map(x=>({x,s:scoreItem(x,q)})).filter(o=>o.s>0).sort((a,b)=>b.s-a.s);
 render(scored.map(o=>o.x),"Поиск: "+q);
}
function searchCar(){
 const b=norm($("#brand").value),m=norm($("#model").value),e=norm($("#engine").value);
 const list=catalog.filter(x=>{
   const brands=norm(x.marks).split(",").map(v=>v.trim());
   const models=norm(x.models).split(",").map(v=>v.trim());
   const engines=norm(x.engine).split(",").map(v=>v.trim());
   return (!b||brands.includes(b))&&(!m||models.includes(m))&&(!e||engines.includes(e));
 });
 render(list,"Подбор по автомобилю");
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),1800)}
async function handleExcel(file){
 try{
  toast("Загружаю Excel в Firebase…");
  await uploadCatalogToStorage(file);
 }catch(e){
  console.error(e);
  toast("Не удалось загрузить Excel: "+(e.message||"ошибка"));
 }
}
function setMode(next){
 mode=next;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 $("#partsMode").classList.toggle("hidden",next!=="parts");$("#carMode").classList.toggle("hidden",next!=="car");
}
$("#searchBtn").onclick=()=>searchParts($("#search").value);$("#search").onkeydown=e=>{if(e.key==="Enter")searchParts(e.target.value)};
$("#carBtn").onclick=searchCar;$("#brand").onchange=()=>{populateModels();populateEngines()};$("#model").onchange=populateEngines;
document.querySelectorAll(".tab").forEach(x=>x.onclick=()=>setMode(x.dataset.mode));
$("#clearBtn").onclick=()=>render(catalog.slice(0,100),"Каталог склада");
$("#uploadBtn").onclick=()=>$("#excelInput").click();$("#excelInput").onchange=e=>{if(e.target.files[0])handleExcel(e.target.files[0])};
$("#themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("amp_auto_dark",document.body.classList.contains("dark")?"1":"0")};
if(localStorage.getItem("amp_auto_dark")==="1")document.body.classList.add("dark");

loadCatalog();initStats();populateBrands();
if(catalog.length)render(catalog.slice(0,100),"Каталог склада");else render([],"Каталог склада");

const ampApp=firebase.initializeApp(ampFirebaseConfig);
const auth=firebase.auth(ampApp);
const ampStorage=firebase.storage(ampApp);
$("#loginBtn").onclick=async()=>{try{await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())}catch(e){$("#loginError").textContent=(e.code||"firebase/error")+": "+(e.message||"Ошибка входа")}};
$("#logoutBtn").onclick=()=>auth.signOut();
auth.onAuthStateChanged(async user=>{
 $("#login").classList.toggle("hidden",!!user);
 if(user){await downloadCatalogFromStorage()}
});
