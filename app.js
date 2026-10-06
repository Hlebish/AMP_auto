const $ = s => document.querySelector(s);

const norm = v =>
  String(v ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яіїєґ0-9]+/g, " ")
    .trim();

const compact = v => norm(v).replace(/\s+/g, "");

const escapeHtml = v =>
  String(v ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));

let catalog = [];
let orderCatalog = [];
let results = [];
window.orderCatalog = orderCatalog;
window.orderReady = Promise.resolve(false);
let mode = "parts";

let crossData = { by_oem: {}, by_article: {} };
window.crossData = crossData;
window.crossReady = Promise.resolve(false);

const aliases = {
  bmw: ["bmw", "бмв"],
  audi: ["audi", "ауди", "ауді"],
  mercedes: ["mercedes", "мерседес", "mb"],
  volkswagen: ["volkswagen", "фольксваген", "vw"],
  toyota: ["toyota", "тойота"],
  honda: ["honda", "хонда"],
  mazda: ["mazda", "мазда"],
  ford: ["ford", "форд"],
  nissan: ["nissan", "ниссан", "ніссан"],
  renault: ["renault", "рено"],
  skoda: ["skoda", "шкода"],
  hyundai: ["hyundai", "хендай", "хюндай"],
  kia: ["kia", "киа", "кіа"],
  mitsubishi: ["mitsubishi", "митсубиси", "мітсубісі"],
  opel: ["opel", "опель"],
  peugeot: ["peugeot", "пежо"],
  citroen: ["citroen", "ситроен", "сітроен"]
};

function expandedToken(t) {
  const x = norm(t);
  const out = new Set([x]);

  for (const arr of Object.values(aliases)) {
    if (arr.includes(x)) {
      arr.forEach(v => out.add(norm(v)));
    }
  }

  return [...out];
}

function isCode(q) {
  return /^(?=.*[a-z])(?=.*\d)[a-z0-9]{4,}$/i.test(compact(q));
}

function exactCodeMatch(q, text) {
  const a = compact(q);
  const b = compact(text);
  return !!a && b.includes(a);
}

function tokenMatch(t, text) {
  const n = norm(text);
  const c = compact(text);

  if (isCode(t)) {
    return exactCodeMatch(t, text);
  }

  return expandedToken(t).some(
    x => n.includes(x) || c.includes(compact(x))
  );
}

function scoreItem(item, q) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);

  if (!tokens.length) return 0;

  const fields = [
    item.a,
    item.n,
    item.o,
    item.b,
    item.m,
    item.e,
    item.v,

    item.catalog_number,
    item.manufacturer_parts,
    item.name,
    item.description,
    item.original_number,
    item.marks,
    item.models,
    item.engine
  ];

  if (isCode(q)) {
    return fields.some(f => exactCodeMatch(q, f)) ? 10000 : 0;
  }

  let score = 0;

  for (const t of tokens) {
    if (fields.some(f => tokenMatch(t, f))) {
      score++;
    } else {
      return 0;
    }
  }

  const cq = compact(q);

  if (
    compact(item.catalog_number) === cq ||
    compact(item.a) === cq
  ) {
    score += 20;
  }

  if (
    compact(item.original_number)
      .split(",")
      .some(x => x === cq)
  ) {
    score += 15;
  }

  return score;
}

function qtyValue(q) {
  if (String(q).trim() === "5+") return 5;

  const n = Number(q);

  return Number.isFinite(n) ? n : 0;
}

function stockOnly(rows) {
  return rows.filter(
    r => r.catalog_number && qtyValue(r.quantity) > 0
  );
}

/* =========================
   СТАТИСТИКА
========================= */

function initStats() {
  // Карточки статистики удалены из интерфейса.
  // Оставляем функцию безопасной для старого кода/кэша.
  const stockEl = $("#stockCount");
  const brandEl = $("#brandCount");
  if (!stockEl && !brandEl) return;

  const brands = new Set();
  catalog.forEach(x => {
    String(x.marks || "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean)
      .forEach(v => brands.add(v.toLowerCase()));
  });

  if (stockEl) {
    stockEl.textContent = catalog.length.toLocaleString("ru-RU");
  }
  if (brandEl) {
    brandEl.textContent = brands.size;
  }
}

/* =========================
   АВТОМОБИЛИ
========================= */

function splitValues(value) {
  return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
}

function hasValue(field, wanted) {
  const w = norm(wanted);
  return !w || splitValues(field).map(v => norm(v)).includes(w);
}

function textOf(item) {
  return [item.name,item.description,item.models,item.engine].filter(Boolean).join(" ");
}

function extractYears(item) {
  const text = textOf(item);
  const ranges = [];
  const rangeRe = /\b((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})?/g;
  let m;
  while ((m = rangeRe.exec(text))) ranges.push({from:Number(m[1]),to:m[2]?Number(m[2]):null});
  if (ranges.length) return ranges;
  return [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map(x=>({from:Number(x[1]),to:Number(x[1])}));
}

function yearMatches(item,wanted) {
  const y=Number(String(wanted||"").replace(/\D/g,""));
  if (!y) return true;
  const ranges=extractYears(item);
  if (!ranges.length) return true;
  return ranges.some(r=>y>=r.from && (!r.to || y<=r.to));
}

function engineVolumes(item) {
  return [...String(item.engine||"").matchAll(/(?<!\d)(\d+(?:[.,]\d+)?)\s*(?:L|л)\b/gi)]
    .map(m=>Number(String(m[1]).replace(",","."))).filter(Number.isFinite);
}

function volumeMatches(item,wanted) {
  const raw=String(wanted||"").trim().replace(",",".");
  if (!raw) return true;
  const value=Number(raw);
  if (!Number.isFinite(value)) return true;
  return engineVolumes(item).some(v=>Math.abs(v-value)<0.06);
}

function fuelType(item) {
  const text=norm(String(item.engine||"")+" "+String(item.name||""));
  if (/electric|ev|e soul|электр/.test(text)) return "Электро";
  if (/hybrid|hev|phev|гибрид/.test(text)) return "Гибрид";
  if (/diesel|tdi|dci|hdi|crdi|td\b|дизел/.test(text)) return "Дизель";
  if (/gdi|tsi|tfsi|mpi|fsi|petrol|gasoline|бенз/.test(text) || engineVolumes(item).length) return "Бензин";
  return "";
}

function bodyType(item) {
  const text=norm(String(item.models||"")+" "+String(item.name||""));
  if (/sedan|седан/.test(text)) return "Седан";
  if (/wagon|station wagon|universal|универсал/.test(text)) return "Универсал";
  if (/hatchback|хетчбек|хэтчбек/.test(text)) return "Хэтчбек";
  if (/suv|crossover|кроссовер/.test(text)) return "SUV";
  if (/coupe|купе/.test(text)) return "Купе";
  if (/cabrio|convertible|кабрио/.test(text)) return "Кабриолет";
  if (/van|фургон/.test(text)) return "Фургон";
  if (/mpv|минивен/.test(text)) return "Минивэн";
  if (/pickup|пикап/.test(text)) return "Пикап";
  return "";
}

function modelMatches(item,query) {
  const q=norm(query);
  if (!q) return true;
  return splitValues(item.models).some(v=>{const n=norm(v); return n===q || n.includes(q);});
}

function catalogForCar(brand="",model="",engine="") {
  const b=norm(brand), m=norm(model), e=norm(engine);
  return catalog.filter(item=>hasValue(item.marks,b)&&modelMatches(item,m)&&hasValue(item.engine,e));
}

function currentCarBase() {
  const b=norm($("#brand")?.value), m=norm($("#model")?.value);
  if (!b || !m) return [];
  return catalog.filter(item=>hasValue(item.marks,b)&&modelMatches(item,m));
}

function populateBrands() {
  const set=new Set();
  catalog.forEach(x=>splitValues(x.marks).forEach(v=>set.add(v)));
  const el=$("#brand"); if(!el) return;
  el.innerHTML='<option value="">Марка</option>'+[...set].sort((a,b)=>a.localeCompare(b,"ru")).map(v=>'<option value="'+escapeHtml(v.toUpperCase())+'">'+escapeHtml(v.toUpperCase())+'</option>').join("");
  populateModels();
}

function populateModels(resetValue = true) {
  const b=norm($("#brand")?.value), list=document.querySelector("#modelOptions"), input=$("#model");
  if(!list||!input) return;

  const current=String(input.value||"");
  const set=new Set();
  if(b) catalogForCar(b).forEach(x=>splitValues(x.models).forEach(v=>set.add(v)));

  list.innerHTML=[...set]
    .sort((a,b)=>a.localeCompare(b,"ru"))
    .slice(0,1000)
    .map(v=>'<option value="'+escapeHtml(v)+'"></option>')
    .join("");

  // При смене марки модель сбрасываем. При редактировании модели
  // сохраняем текущее значение, чтобы его можно было спокойно заменить.
  if(resetValue) input.value="";

  if($("#engine")) $("#engine").innerHTML='<option value="">Двигатель — любой</option>';
  if($("#volume")) $("#volume").value="";
  if($("#fuel")) $("#fuel").innerHTML='<option value="">Топливо — любое</option>';
  if($("#body")) $("#body").innerHTML='<option value="">Кузов — любой</option>';
}

function populateCarFilters() {
  const rows=currentCarBase(), engineEl=$("#engine"), fuelEl=$("#fuel"), bodyEl=$("#body");
  const engines=new Set(), fuels=new Set(), bodies=new Set();
  rows.forEach(x=>{splitValues(x.engine).forEach(v=>engines.add(v)); const f=fuelType(x), b=bodyType(x); if(f) fuels.add(f); if(b) bodies.add(b);});
  if(engineEl) engineEl.innerHTML='<option value="">Двигатель — любой</option>'+[...engines].sort((a,b)=>a.localeCompare(b,"ru")).slice(0,500).map(v=>'<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join("");
  if(fuelEl) fuelEl.innerHTML='<option value="">Топливо — любое</option>'+[...fuels].sort((a,b)=>a.localeCompare(b,"ru")).map(v=>'<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join("");
  if(bodyEl) bodyEl.innerHTML='<option value="">Кузов — любой</option>'+[...bodies].sort((a,b)=>a.localeCompare(b,"ru")).map(v=>'<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join("");
}

function populateEngines() { populateCarFilters(); }
/* =========================
   РЕЗУЛЬТАТЫ
========================= */

function render(
  list,
  title = "Каталог склада"
) {

  results =
    list.slice(0, 300);

  $("#resultTitle").textContent =
    title +
    (
      list.length > 300
        ? " · первые 300"
        : ""
    );

  if (!list.length) {

    $("#results").innerHTML =
      '<div class="empty">' +
      "Ничего не найдено среди деталей, " +
      "которые есть в наличии." +
      "</div>";

    return;
  }

  $("#results").innerHTML =
    list
      .slice(0, 300)
      .map(x => {

        const qty =
          String(
            x.quantity || ""
          );

        return `
          <article class="result-card ${x._order ? "order-result" : ""}">
            <div>
              <div class="result-name">
                ${escapeHtml(
                  x.name ||
                  x.catalog_number
                )}
              </div>

              <div class="meta">

                <strong>
                  ${escapeHtml(
                    x.catalog_number
                  )}
                </strong>

                ·

                ${escapeHtml(
                  x.manufacturer_parts ||
                  x._order_brand ||
                  ""
                )}

                <br>

                ${
                  x._order
                    ? '<span class="order-badge">🟠 ПОД ЗАКАЗ</span><br>Производитель: ' +
                      escapeHtml(x._order_brand || "Не указан")
                    : '<span class="stock-badge">🟢 НА СКЛАДЕ</span>'
                }

                <br>

                OEM:
                ${escapeHtml(
                  String(
                    x.original_number ||
                    x._order_oem ||
                    ""
                  )
                    .split(",")
                    .slice(0, 6)
                    .join(", ")
                )}

                ${
                  x._order
                    ? "<br>Кросс: " + escapeHtml(x._order_oem || "")
                    : ""
                }

                ${
                  x.marks
                    ? "<br>Авто: " + escapeHtml(x.marks)
                    : ""
                }

                ${
                  x.models
                    ? " · " +
                      escapeHtml(
                        String(x.models)
                          .split(",")
                          .slice(0, 3)
                          .join(", ")
                      )
                    : ""
                }

                ${
                  !x._order
                    ? '<br><span class="qty">В наличии: ' +
                      escapeHtml(qty) +
                      (x.price
                        ? " · " + Number(x.price).toLocaleString("uk-UA") + " ₴"
                        : "") +
                      "</span>"
                    : ""
                }

              </div>
            </div>
          </article>
        `;
      })
      .join("");
}

/* =========================
   ПОИСК
========================= */

function searchParts(q) {

  if (!q.trim()) {

    render(
      catalog.slice(0, 100),
      "Каталог склада"
    );

    return;
  }

  const scored =
    catalog
      .map(x => ({
        x,
        s: scoreItem(x, q)
      }))
      .filter(o => o.s > 0)
      .sort(
        (a, b) =>
          b.s - a.s
      );

  render(
    scored.map(o => o.x),
    "Поиск: " + q
  );
}

async function searchCar() {
  try { if(window.fullCatalogReady) await window.fullCatalogReady; } catch(e) {}

  const b=norm($("#brand")?.value);
  const m=String($("#model")?.value||"").trim();
  const selectedEngine=String($("#engine")?.value||"").trim();
  const selectedYear=String($("#year")?.value||"").trim();
  const selectedVolume=String($("#volume")?.value||"").trim();
  const selectedFuel=String($("#fuel")?.value||"").trim();
  const selectedBody=String($("#body")?.value||"").trim();

  if(!b){toast("⚠️ Выберите марку автомобиля");return;}
  if(!m){toast("⚠️ Введите модель автомобиля");return;}

  const matched=catalog.filter(item=>{
    if(!hasValue(item.marks,b)) return false;
    if(!modelMatches(item,m)) return false;
    if(selectedEngine&&!hasValue(item.engine,selectedEngine)) return false;
    if(selectedYear&&!yearMatches(item,selectedYear)) return false;
    if(selectedVolume&&!volumeMatches(item,selectedVolume)) return false;
    if(selectedFuel&&fuelType(item)!==selectedFuel) return false;
    if(selectedBody&&bodyType(item)!==selectedBody) return false;
    return true;
  });

  const stockList=matched.slice();
  const stockArticles=new Set(stockList.map(x=>compact(x.catalog_number)).filter(Boolean));

  const orderByArticle=new Map();
  if(Array.isArray(window.orderCatalog)){
    for(const item of window.orderCatalog){
      const key=compact(item.catalog_number);
      if(key&&!orderByArticle.has(key)) orderByArticle.set(key,item);
    }
  }

  const orderList=[], seenOrder=new Set();
  for(const stockItem of matched){
    const oems=String(stockItem.original_number||"").split(",").map(v=>compact(v)).filter(Boolean);
    for(const oem of oems){
      const rows=window.crossData?.by_oem?.[oem]||[];
      for(const row of rows){
        const article=compact(row.article);
        if(!article||stockArticles.has(article)||seenOrder.has(article)) continue;
        const existing=orderByArticle.get(article);
        const item=existing
          ? {...existing,_order:true,_order_brand:existing.manufacturer_parts||row.brand||"",_order_oem:row.oem||stockItem.original_number||""}
          : {_order:true,_order_brand:row.brand||"",_order_oem:row.oem||stockItem.original_number||"",catalog_number:row.article,manufacturer_parts:row.brand||"",name:"Деталь "+row.article,original_number:row.oem||"",quantity:0,price:""};
        seenOrder.add(article); orderList.push(item);
      }
    }
  }

  const list=[...stockList,...orderList];
  const titleParts=[$("#brand")?.value,m,selectedYear,selectedVolume?(selectedVolume+" л"):"",selectedEngine].filter(Boolean);
  render(list,"Подбор: "+titleParts.join(" · "));

  setTimeout(()=>document.querySelector(".results-section")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
}

/* =========================
   УВЕДОМЛЕНИЯ
========================= */

function toast(msg) {

  const t =
    $("#toast");

  t.textContent =
    msg;

  t.classList.add(
    "show"
  );

  clearTimeout(
    window.__toast
  );

  window.__toast =
    setTimeout(
      () =>
        t.classList.remove(
          "show"
        ),
      2500
    );
}

/* =========================
   РЕЖИМЫ
========================= */

function setMode(next) {

  mode = next;

  document
    .querySelectorAll(".tab")
    .forEach(x =>
      x.classList.toggle(
        "active",
        x.dataset.mode === next
      )
    );

  $("#partsMode")
    .classList.toggle(
      "hidden",
      next !== "parts"
    );

  $("#carMode")
    .classList.toggle(
      "hidden",
      next !== "car"
    );
}

/* =========================
   EVENTS
========================= */

$("#carBtn").onclick=searchCar;
$("#brand").onchange=()=>populateModels(true);
$("#model").onfocus=()=>populateModels(false);\n$("#model").onclick=()=>populateModels(false);\n$("#model").oninput=()=>populateCarFilters();
$("#year").onkeydown=e=>{if(e.key==="Enter")searchCar();};
$("#volume").onkeydown=e=>{if(e.key==="Enter")searchCar();};

$("#clearBtn").onclick=()=>{
  if($("#brand")) $("#brand").value="";
  if($("#model")) $("#model").value="";
  if($("#year")) $("#year").value="";
  if($("#volume")) $("#volume").value="";
  populateModels();
  render([],"Выберите автомобиль");
};

/* =========================
   THEME
========================= */

$("#themeBtn").onclick =
  () => {

    document.body
      .classList
      .toggle("dark");

    localStorage.setItem(
      "amp_auto_dark",
      document.body.classList.contains(
        "dark"
      )
        ? "1"
        : "0"
    );
  };

if (
  localStorage.getItem(
    "amp_auto_dark"
  ) === "1"
) {
  document.body.classList.add(
    "dark"
  );
}

