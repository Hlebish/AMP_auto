const ampFirebaseConfig={apiKey:"AIzaSyBHAc4Fra0XG8wtqwMjH_kk8T4rNhQxvMw",authDomain:"amp-auto.firebaseapp.com",projectId:"amp-auto",storageBucket:"amp-auto.firebasestorage.app",messagingSenderId:"305575986701",appId:"1:305575986701:web:424e1d1e14a2855274f744"};
const warehouseFirebaseConfig={apiKey:"AIzaSyAFd_IPlACJlpxeGsNE7Iq3dQm-VYu5Ba4",authDomain:"warehouse-map-b6ed6.firebaseapp.com",databaseURL:"https://warehouse-map-b6ed6-default-rtdb.europe-west1.firebasedatabase.app",projectId:"warehouse-map-b6ed6",storageBucket:"warehouse-map-b6ed6.firebasestorage.app",messagingSenderId:"196261680344",appId:"1:196261680344:web:fdd54671cf57690744f3ad"};
const $=s=>document.querySelector(s), norm=v=>String(v??"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-яіїєґ0-9]+/g," ").trim();
const compact=v=>norm(v).replace(/\s+/g,"");
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let catalog=[],results=[],warehouse={},mode="parts",addresses=new Map(),activeAddress=null;

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
 $("#results").innerHTML=list.slice(0,300).map((x,i)=>{
   const ad=findAddresses(x.a);
   const qty=String(x.quantity||"");
   return '<article class="result-card"><div><div class="result-name">'+escapeHtml(x.name||x.a)+'</div><div class="meta"><strong>'+escapeHtml(x.catalog_number)+'</strong> · '+escapeHtml(x.manufacturer_parts||"")+'<br>OEM: '+escapeHtml(String(x.original_number||"").split(",").slice(0,6).join(", "))+'<br>Авто: '+escapeHtml(x.marks||"")+(x.models?" · "+escapeHtml(String(x.models).split(",").slice(0,3).join(", ")):"")+'<br><span class="qty">В наличии: '+escapeHtml(qty)+'</span>'+(x.price? ' · '+Number(x.price).toLocaleString("uk-UA")+' ₴':"")+'</div></div><div class="result-actions">'+(ad.length?'<button class="map-btn" onclick="showOnMap('+i+')">🗺️ '+ad[0]+'</button>':'<span class="muted">Адрес не найден</span>')+'</div></article>';
 }).join("");
}
function searchParts(q){
 if(!q.trim()){render(catalog.slice(0,100),"Каталог склада");return}
 const scored=catalog.map(x=>({x,s:scoreItem(x,q)})).filter(o=>o.s>0).sort((a,b)=>b.s-a.s);
 render(scored.map(o=>o.x),"Поиск: "+q);buildAddresses(results);
}
function searchCar(){
 const b=norm($("#brand").value),m=norm($("#model").value),e=norm($("#engine").value);
 const list=catalog.filter(x=>{
   const brands=norm(x.marks).split(",").map(v=>v.trim());
   const models=norm(x.models).split(",").map(v=>v.trim());
   const engines=norm(x.engine).split(",").map(v=>v.trim());
   return (!b||brands.includes(b))&&(!m||models.includes(m))&&(!e||engines.includes(e));
 });
 render(list,"Подбор по автомобилю");buildAddresses(results);
}
function addressText(s,l,n){return s+"-"+l+n}
const left=["A","B","C","D","E"], right=["F","G","H","J","K"];
function cellEntries(){
 const out=[];
 for(let s=1;s<=5;s++){
  const letters=s===1?left.concat(right):left.concat(right);
  for(const l of letters)for(let n=1;n<=10;n++){
   const v=warehouse["S"+s]?.[l]?.[String(n)]||"";
   if(v)out.push({s:"S"+s,l,n:String(n),a:addressText("S"+s,l,n),v});
  }
 }
 return out;
}
function findAddresses(article){
 const q=compact(article); if(!q)return [];
 return cellEntries().filter(c=>compact(c.v).includes(q)).map(c=>c.a);
}
function coords(s,l,n){
 const street=Number(String(s).replace("S",""));
 const letters=left.includes(l)?left:right;
 const sideIndex=letters.indexOf(l);
 const xBase=[18,38,58,78,91][street-1]||50;
 const sideShift=left.includes(l)?-2.8:2.8;
 let y=n>=4?48-((n-4)/6)*35:88-((n-1)/2)*22;
 return {x:Math.max(2,Math.min(98,xBase+sideShift)),y:Math.max(3,Math.min(97,y))};
}
function drawMarkers(){
 const root=$("#markers");root.innerHTML="";
 addresses.forEach((arr,a)=>{
  const first=arr[0];const c=coords(first.s,first.l,first.n);
  const el=document.createElement("button");el.className="marker";el.style.left=c.x+"%";el.style.top=c.y+"%";el.dataset.address=a;
  el.innerHTML='<span>'+a+'</span>';el.title=arr.map(x=>x.a).join(", ");
  el.onclick=()=>selectAddress(a);
  root.appendChild(el);
 });
}
function selectAddress(a){
 activeAddress=a;
 document.querySelectorAll(".marker").forEach(x=>x.classList.toggle("active",x.dataset.address===a));
 document.querySelectorAll(".address").forEach(x=>x.classList.toggle("active",x.dataset.address===a));
 $("#mapStatus").textContent=a;
 const marker=document.querySelector('.marker[data-address="'+CSS.escape(a)+'"]');
 if(marker){marker.scrollIntoView({behavior:"smooth",block:"center"});}
}
function buildAddresses(list=results){
 addresses.clear();
 list.forEach(item=>{
   for(const c of cellEntries()){
    if(compact(c.v).includes(compact(item.catalog_number))){
      if(!addresses.has(c.a))addresses.set(c.a,[]);
      addresses.get(c.a).push({...c,item});
    }
   }
 });
 $("#addressCount").textContent=addresses.size;
 $("#addressGrid").innerHTML=addresses.size?[...addresses.entries()].map(([a,items])=>'<div class="address" data-address="'+escapeHtml(a)+'" onclick="selectAddress('+JSON.stringify(a)+')"><b>'+escapeHtml(a)+'</b><small>'+items.length+' совпадений</small></div>').join(""):'<div class="empty">Для найденных деталей адреса в карте склада не найдены.</div>';
 drawMarkers();
}
function showOnMap(i){const item=results[i];buildAddresses([item]);const ad=findAddresses(item.catalog_number)[0];if(ad)selectAddress(ad);document.querySelector(".map-section").scrollIntoView({behavior:"smooth",block:"start"});}
window.showOnMap=showOnMap;
window.selectAddress=selectAddress;

async function loadWarehouse(){
 try{
   const snap=await warehouseDb.ref("warehouse/cells").once("value");
   warehouse=snap.val()||{};
   if(results.length)buildAddresses(results);
 }catch(e){console.error(e);$("#mapStatus").textContent="Не удалось получить карту склада";}
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
$("#clearBtn").onclick=()=>{render(catalog.slice(0,100),"Каталог склада");buildAddresses([])};
$("#uploadBtn").onclick=()=>$("#excelInput").click();$("#excelInput").onchange=e=>{if(e.target.files[0])handleExcel(e.target.files[0])};
$("#themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("amp_auto_dark",document.body.classList.contains("dark")?"1":"0")};
if(localStorage.getItem("amp_auto_dark")==="1")document.body.classList.add("dark");

loadCatalog();initStats();populateBrands();
if(catalog.length)render(catalog.slice(0,100),"Каталог склада");else render([],"Каталог склада");

const ampApp=firebase.initializeApp(ampFirebaseConfig);
const warehouseApp=firebase.initializeApp(warehouseFirebaseConfig,"warehouse");
const auth=firebase.auth(ampApp);
const ampStorage=firebase.storage(ampApp);
const warehouseDb=firebase.database(warehouseApp);
$("#loginBtn").onclick=async()=>{try{await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())}catch(e){$("#loginError").textContent=e.message||"Ошибка входа"}};
$("#logoutBtn").onclick=()=>auth.signOut();
auth.onAuthStateChanged(async user=>{
 $("#login").classList.toggle("hidden",!!user);
 if(user){await loadWarehouse();await downloadCatalogFromStorage();if(catalog.length)buildAddresses(results)}
});
