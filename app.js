const $ = s => document.querySelector(s);

const loadingJobs = new Map();
let loadingJobId = 0;

function syncAppLoading() {
  const indicator = $("#loadingIndicator");
  const text = $("#loadingText");
  const active = loadingJobs.size > 0;

  if (text && active) {
    const labels = [...loadingJobs.values()];
    text.textContent = labels[labels.length - 1] || "Загрузка…";
  }

  if (indicator) {
    indicator.classList.toggle("show", active);
    indicator.setAttribute("aria-hidden", active ? "false" : "true");
  }

  document.body?.toggleAttribute("aria-busy", active);
}

function startAppLoading(message = "Загрузка…") {
  const id = ++loadingJobId;
  const startedAt = performance.now();
  const MIN_VISIBLE_MS = 220;

  loadingJobs.set(id, String(message || "Загрузка…"));
  syncAppLoading();

  return {
    setText(nextMessage) {
      if (!loadingJobs.has(id)) return;
      loadingJobs.set(id, String(nextMessage || "Загрузка…"));
      syncAppLoading();
    },
    stop() {
      if (!loadingJobs.has(id)) return;

      const finish = () => {
        if (!loadingJobs.has(id)) return;
        loadingJobs.delete(id);
        syncAppLoading();
      };

      const remaining = MIN_VISIBLE_MS - (performance.now() - startedAt);
      if (remaining > 0) {
        setTimeout(finish, remaining);
      } else {
        finish();
      }
    }
  };
}

window.startAppLoading = startAppLoading;

const norm = v =>
  String(v ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яіїєґ0-9]+/g, " ")
    .trim();

const compact = v => norm(v).replace(/\s+/g, "");

function isOwnManufacturer(value) {
  const key = compact(value);
  return key === "amparts" || key.startsWith("amparts");
}

function isOwnArticle(article, manufacturer = "") {
  const key = compact(article);
  if (!key) return false;
  if (isOwnManufacturer(manufacturer)) return true;
  return !!window.ownStockArticles?.has(key);
}

function crossFamilyRows(query) {
  const db = window.crossData || {};
  const byOem = db.by_oem || {};
  const byArticle = db.by_article || {};
  const seed = compact(query);
  if (!seed) return [];

  const queue = [
    ...(byOem[seed] || []),
    ...(byArticle[seed] || [])
  ];

  const rows = [];
  const seen = new Set();
  let cursor = 0;

  while (cursor < queue.length && rows.length < 3000) {
    const row = queue[cursor++];
    if (!row) continue;

    const id = [
      compact(row.article || ""),
      compact(row.brand || ""),
      compact(row.oem || ""),
      compact(row.oem_brand || "")
    ].join("|");

    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push(row);

    const oemKey = compact(row.oem || "");
    const articleKey = compact(row.article || "");

    if (oemKey) queue.push(...(byOem[oemKey] || []));
    if (articleKey) queue.push(...(byArticle[articleKey] || []));
  }

  return rows;
}

function findOwnCrossReference(query) {
  const rows = crossFamilyRows(query);
  const own = rows
    .filter(row => typeof isOwnManufacturer === "function" && isOwnManufacturer(row.brand || ""))
    .sort((a,b) => {
      const ownStock = window.ownStockArticles || new Set();
      const sa = ownStock.has(compact(a.article || "")) ? 0 : 1;
      const sb = ownStock.has(compact(b.article || "")) ? 0 : 1;
      return sa - sb;
    });

  return {
    rows,
    own: own[0] || null,
    orderRows: rows.filter(row =>
      !(typeof isOwnManufacturer === "function" && isOwnManufacturer(row.brand || ""))
    )
  };
}

window.crossFamilyRows = crossFamilyRows;
window.findOwnCrossReference = findOwnCrossReference;


function makeUnavailableOwnPart(row, fallbackOem = "") {
  const article = String(row?.article || row?.catalog_number || "").trim();
  const manufacturer = String(
    row?.brand ||
    row?.manufacturer_parts ||
    row?._order_brand ||
    "AMPARTS"
  ).trim();

  return {
    _unavailable: true,
    _order: false,
    _amparts: true,
    source: "amparts",
    catalog_number: article,
    manufacturer_parts: manufacturer || "AMPARTS",
    name: row?.name || ("Деталь " + article),
    original_number: row?.oem || row?._order_oem || fallbackOem || "",
    quantity: 0,
    price: row?.price ?? ""
  };
}

window.isOwnManufacturer = isOwnManufacturer;
window.isOwnArticle = isOwnArticle;
window.makeUnavailableOwnPart = makeUnavailableOwnPart;

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

function modelCode(value) {
  const m = norm(value).match(/\(([^)]{1,24})\)/);
  return m ? compact(m[1]) : "";
}

function modelFamily(value) {
  let s = norm(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(mk|gen|generation|поколение)\b/g, " ")
    .replace(/\b(i{1,3}|iv|v)\b/g, " ");

  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    s = tokens
      .filter((t, i) => !(i > 0 && /^\d{1,2}$/.test(t)))
      .join(" ");
  }

  s = s
    .replace(/\b(sedan|saloon|wagon|touring|variant|estate|combi|hatchback|hatch|coupe|cabrio|convertible|van|mpv|pickup|cab|универсал|седан|купе|кабриолет|фургон|минивен|пикап|хетчбек|хэтчбек)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function canonicalModel(value) {
  let s = norm(value)
    .replace(/\b(mk|gen|generation|поколение)\b/g, " ")
    .replace(/\b(i{1,3}|iv|v)\b/g, " ");

  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    s = tokens
      .filter((t, i) => !(i > 0 && /^\d{1,2}$/.test(t)))
      .join(" ");
  }

  return s
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPartName(value) {
  let text = String(value ?? "").trim();
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^\s*деталь\b\s*[:№#-]?\s*/iu, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function modelTemplateKey(value) {
  const code = modelCode(value);
  const family = compact(modelFamily(value));
  return (code ? code + "|" : "") + family;
}

function prettyModelFamily(value) {
  const family = modelFamily(value);
  if (!family) return "";
  return family.split(/\s+/).filter(Boolean).map(token => {
    if (/^[a-z]{1,3}-[a-z0-9]+$/i.test(token)) {
      const [head, ...rest] = token.split("-");
      return head.toUpperCase() + (rest.length ? "-" + rest.join("-") : "");
    }
    if (/^[a-z]+\d+[a-z0-9]*$/i.test(token) && token.length <= 6) return token.toUpperCase();
    if (/^[a-z]{2,3}$/i.test(token)) return token.toUpperCase();
    return token.charAt(0).toUpperCase() + token.slice(1);
  }).join(" ");
}

function modelTemplateLabel(value) {
  const family = prettyModelFamily(value);
  const m = String(value ?? "").match(/\(([^)]{1,80})\)/);
  const code = m ? m[1].trim().replace(/\s+/g, " ") : "";
  if (!family) return code ? "(" + code + ")" : String(value ?? "").trim();
  return code ? family + " (" + code + ")" : family;
}

function modelTemplateScore(value) {
  const raw = String(value ?? "");
  let score = raw.length;
  if (/\b(sedan|saloon|wagon|touring|variant|estate|combi|hatchback|hatch|coupe|cabrio|convertible|van|mpv|pickup|cab)\b/i.test(raw)) score += 50;
  if (/\b(mk|gen|generation|поколение)\b/i.test(raw)) score += 30;
  if (/\b(i{1,3}|iv|v)\b/i.test(raw)) score += 15;
  return score;
}

function modelTemplatesForBrand(brand) {
  const b = norm(brand);
  const groups = new Map();
  if (!b) return [];
  catalog.forEach(item => {
    if (!hasValue(item.marks, b)) return;
    splitValues(item.models).forEach(raw => {
      const key = modelTemplateKey(raw);
      if (!key) return;
      const current = groups.get(key);
      if (!current || modelTemplateScore(raw) < modelTemplateScore(current.raw)) {
        groups.set(key, { key, raw, label: modelTemplateLabel(raw) });
      }
    });
  });
  return [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "ru", { numeric: true, sensitivity: "base" })
  );
}

function cleanModelList(value) {
  const seen = new Set();
  const out = [];
  splitValues(value).forEach(raw => {
    const key = modelTemplateKey(raw) || compact(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(modelTemplateLabel(raw));
  });
  return out;
}
function modelMatches(item, query) {
  const q = canonicalModel(query);
  if (!q) return true;

  const qCode = modelCode(query);
  const qFamily = modelFamily(query);

  return splitValues(item.models).some(value => {
    const n = canonicalModel(value);

    if (n === q || n.includes(q) || q.includes(n)) return true;

    const code = modelCode(value);
    if (qCode && code && qCode === code) {
      const family = modelFamily(value);
      if (
        family === qFamily ||
        family.startsWith(qFamily + " ") ||
        qFamily.startsWith(family + " ")
      ) {
        return true;
      }
    }

    return false;
  });
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

function populateBrands(preserveValue = true) {
  const set = new Set();
  catalog.forEach(x => splitValues(x.marks).forEach(v => set.add(v)));

  const el = $("#brand");
  if (!el) return;

  const current = preserveValue ? String(el.value || "") : "";
  const html =
    '<option value="">Марка</option>' +
    [...set]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map(v =>
        '<option value="' + escapeHtml(v.toUpperCase()) + '">' +
        escapeHtml(v.toUpperCase()) +
        '</option>'
      )
      .join("");

  el.innerHTML = html;

  if (current && [...el.options].some(o => norm(o.value) === norm(current))) {
    el.value = current;
  }
}

function populateModels(resetValue = true) {
  const b = norm($("#brand")?.value);
  const el = $("#model");
  if (!el) return;

  const current = String(el.value || "");
  const templates = modelTemplatesForBrand(b);

  el.innerHTML =
    '<option value="">Модель</option>' +
    templates
      .slice(0, 1000)
      .map(t =>
        '<option value="' + escapeHtml(t.raw) + '" data-model-template="' +
        escapeHtml(t.key) + '">' +
        escapeHtml(t.label) +
        '</option>'
      )
      .join("");

  if (!resetValue && current) {
    const currentKey = modelTemplateKey(current);
    const option = [...el.options].find(o =>
      modelTemplateKey(o.value) === currentKey ||
      norm(o.value) === norm(current)
    );
    el.value = option ? option.value : "";
  } else {
    el.value = "";
  }

  populateCarFilters();
}
function populateYears(rows, resetValue = true) {
  const el = $("#year");
  if (!el) return;

  const current = resetValue ? "" : String(el.value || "");
  const years = new Set();

  rows.forEach(item => {
    extractYears(item).forEach(r => {
      const from = Math.max(1950, Number(r.from) || 0);
      const to = Math.min(2035, Number(r.to || r.from) || from);
      for (let y = from; y <= to; y++) years.add(y);
    });
  });

  const values = [...years].sort((a, b) => b - a);

  el.innerHTML =
    '<option value="">Год — любой</option>' +
    values.map(y => '<option value="' + y + '">' + y + '</option>').join("");

  if (current && values.includes(Number(current))) {
    el.value = current;
  } else {
    el.value = "";
  }
}

function populateVolumes(rows, resetValue = true) {
  const el = $("#volume");
  if (!el) return;

  const current = resetValue ? "" : String(el.value || "");
  const values = [...new Set(
    rows.flatMap(engineVolumes)
      .map(v => Number(v))
      .filter(Number.isFinite)
  )].sort((a, b) => a - b);

  el.innerHTML =
    '<option value="">Объём — любой</option>' +
    values.map(v =>
      '<option value="' + v + '">' +
      v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) +
      " л</option>"
    ).join("");

  if (current && values.some(v => Math.abs(v - Number(current)) < 0.001)) {
    el.value = current;
  } else {
    el.value = "";
  }
}

function populateCarFilters() {
  const rows = currentCarBase();
  const engineEl = $("#engine");
  const fuelEl = $("#fuel");
  const bodyEl = $("#body");

  const engines = new Set();
  const fuels = new Set();
  const bodies = new Set();

  rows.forEach(x => {
    splitValues(x.engine).forEach(v => engines.add(v));
    const f = fuelType(x);
    const b = bodyType(x);
    if (f) fuels.add(f);
    if (b) bodies.add(b);
  });

  if (engineEl) {
    engineEl.innerHTML =
      '<option value="">Двигатель — любой</option>' +
      [...engines]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .slice(0, 500)
        .map(v =>
          '<option value="' + escapeHtml(v) + '">' +
          escapeHtml(v) +
          '</option>'
        )
        .join("");
  }

  if (fuelEl) {
    fuelEl.innerHTML =
      '<option value="">Топливо — любое</option>' +
      [...fuels]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map(v =>
          '<option value="' + escapeHtml(v) + '">' +
          escapeHtml(v) +
          '</option>'
        )
        .join("");
  }

  if (bodyEl) {
    bodyEl.innerHTML =
      '<option value="">Кузов — любой</option>' +
      [...bodies]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map(v =>
          '<option value="' + escapeHtml(v) + '">' +
          escapeHtml(v) +
          '</option>'
        )
        .join("");
  }

  populateYears(rows);
  populateVolumes(rows);
}
function populateEngines() { populateCarFilters(); }

/* =========================
   ФИЛЬТР ПО ТИПУ ДЕТАЛИ
========================= */

const PART_TYPES = {
  капот:["капот","hood","bonnet"], крыло:["крыло","крыла","крылья","крило","wing","fender"],
  бампер:["бампер","бамперы","bumper"], дверь:["дверь","двери","дверей","дверью","дверця","door"],
  фара:["фара","фары","фар","headlight","headlamp"], фонарь:["фонарь","фонари","ліхтар","tail light","taillight"],
  решетка:["решетка","решётка","решітка","grille"], зеркало:["зеркало","зеркала","дзеркало","mirror"],
  стекло:["стекло","стекла","скло","glass"], подкрылок:["подкрылок","подкрылка","подкрылки","підкрилок","fender liner"],
  усилитель:["усилитель","усилителя","підсилювач","reinforcement"], накладка:["накладка","накладки","накладку","накладок","накладні"],
  облицовка:["облицовка","облицовки","облицювання","trim"], замок:["замок","замка","замку","lock","latch"],
  ручка:["ручка","ручки","ручку","handle"], молдинг:["молдинг","молдинги","molding"],
  спойлер:["спойлер","спойлера","spoiler"], крышка:["крышка","крышки","крышку","кришка","cover"],
  защита:["защита","защиты","защиту","захист","guard"], поршень:["поршень","поршни","поршня","поршней","piston","pistons"],
  колодка:["колодка","колодки","тормозная колодка","brake pad"], диск:["диск","диски","тормозной диск","brake disc"],
  фильтр:["фильтр","фильтры","filter"], свеча:["свеча","свечи","свеча зажигания","spark plug"],
  пластик:["пластик","пластика","пластиковый","пластиковая","пластикове","plastic"]
};

let activePartType = "";
let lastRenderedList = [];

function detectPartType(item) {
  const text = norm([item?.name, item?.description].filter(Boolean).join(" "));
  if (!text) return "";

  for (const type of Object.keys(PART_TYPES)) {
    for (const value of PART_TYPES[type]) {
      const alias = norm(value);
      if (alias && text.includes(alias)) return type;
    }
  }

  return "";
}

function filterByPartType(list) {
  if (!activePartType) return list;
  return list.filter(item => (item?._partType || detectPartType(item)) === activePartType);
}

/* =========================
   РЕЗУЛЬТАТЫ
========================= */

function render(
  list,
  title = "Каталог склада",
  showAll = false
) {

  lastRenderedList = Array.isArray(list) ? list.slice() : [];
  const filteredList = filterByPartType(lastRenderedList);
  const displayList = showAll ? filteredList : filteredList.slice(0, 300);
  results = displayList.slice();

  const titleEl = $("#resultTitle");
  const baseTitle = title + (!showAll && list.length > 300 ? " · первые 300" : "");
  if (titleEl) {
    titleEl.dataset.baseTitle = baseTitle;
    titleEl.textContent = activePartType
      ? baseTitle + " · " + ($("#partTypeFilter")?.selectedOptions?.[0]?.textContent || activePartType)
      : baseTitle;
  }

  if (!filteredList.length) {

    $("#results").innerHTML =
      '<div class="empty">' +
      "Ничего не найдено среди деталей, " +
      "которые есть в наличии." +
      "</div>";

    return;
  }

  $("#results").innerHTML =
    displayList
      .map(x => {

        const qty =
          String(
            x.quantity || ""
          );

        return `
          <article class="result-card ${x._order ? "order-result" : x._unavailable ? "unavailable-result" : ""}">
            <div>
              <div class="result-name">
                ${escapeHtml(
                  cleanPartName(
                    x.name ||
                    x.catalog_number
                  )
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
                  x._unavailable
                    ? '<span class="unavailable-badge">🔴 НЕТ В НАЛИЧИИ</span><br>Производитель: ' +
                      escapeHtml(x.manufacturer_parts || "AMPARTS")
                    : x._order
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
                    ? "<br>" + (
                        x._order_for_article
                          ? "Кросс к: " + escapeHtml(x._order_for_article)
                          : "Кросс: " + escapeHtml(x._order_oem || "")
                      )
                    : ""
                }

                ${
                  x._unavailable && x._order_offer_article
                    ? "<br>Можно заказать: " + escapeHtml(x._order_offer_article) +
                      (x._order_offer_brand ? " · " + escapeHtml(x._order_offer_brand) : "")
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
                        cleanModelList(x.models)
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
  const b=norm($("#brand")?.value);
  const m=String($("#model")?.value||"").trim();
  const selectedEngine=String($("#engine")?.value||"").trim();
  const selectedYear=String($("#year")?.value||"").trim();
  const selectedVolume=String($("#volume")?.value||"").trim();
  const selectedFuel=String($("#fuel")?.value||"").trim();
  const selectedBody=String($("#body")?.value||"").trim();

  if(!b){toast("⚠️ Выберите марку автомобиля");return;}
  if(!m){toast("⚠️ Выберите модель автомобиля");return;}

  const loading = window.startAppLoading?.("Подбираем детали…");

  // Даём браузеру отрисовать уже показанный loader до тяжёлых операций
  // IndexedDB/кроссов/прайса. Особенно важно на мобильных устройствах.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  try {
    if(window.fullCatalogReady) {
      loading?.setText("Проверяем каталог…");
      await window.fullCatalogReady;
    }
    if(window.ensureCrossDatabase) {
      loading?.setText("Загружаем кроссы…");
      await window.ensureCrossDatabase();
    }
    if(window.ensureOrderCatalog) {
      loading?.setText("Загружаем товары под заказ…");
      await window.ensureOrderCatalog();
    }

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

    const orderByArticle=new Map();
    if(Array.isArray(window.orderCatalog)){
      for(const item of window.orderCatalog){
        const key=compact(item.catalog_number);
        if(key&&!orderByArticle.has(key)) orderByArticle.set(key,item);
      }
    }

    const orderList=[], seenOrder=new Set(), seenOwnUnavailable=new Set();
    const ownStockArticles = window.ownStockArticles || new Set();

    for(const stockItem of matched){
      const oems=String(stockItem.original_number||"").split(",").map(v=>compact(v)).filter(Boolean);
      for(const oem of oems){
        const rows=window.crossData?.by_oem?.[oem]||[];
        const ownRow = rows.find(row =>
          typeof window.isOwnManufacturer === "function"
            ? window.isOwnManufacturer(row.brand || "")
            : compact(row.brand || "") === "amparts"
        );
        const firstOrderRow = rows.find(row =>
          !(typeof window.isOwnManufacturer === "function"
            ? window.isOwnManufacturer(row.brand || "")
            : compact(row.brand || "") === "amparts")
        );
        const ownReferenceArticle =
          compact(ownRow?.article || stockItem.catalog_number || "");

        for(const row of rows){
          const article=compact(row.article);
          if(!article||seenOrder.has(article)||seenOwnUnavailable.has(article)) continue;

          // Наш артикул не может стать "ПОД ЗАКАЗ".
          if(ownStockArticles.has(article)) continue;

          const ownByManufacturer =
            typeof window.isOwnManufacturer === "function"
              ? window.isOwnManufacturer(row.brand || "")
              : compact(row.brand || "") === "amparts";

          if(ownByManufacturer){
            const item = typeof window.makeUnavailableOwnPart === "function"
              ? window.makeUnavailableOwnPart(row, stockItem.original_number || oem)
              : {
                  _unavailable:true,
                  _order:false,
                  _amparts:true,
                  catalog_number:row.article,
                  manufacturer_parts:row.brand || "AMPARTS",
                  name:row.article,
                  original_number:row.oem || stockItem.original_number || oem,
                  quantity:0,
                  price:""
                };

            if (firstOrderRow) {
              item._order_offer_article = firstOrderRow.article || "";
              item._order_offer_brand = firstOrderRow.brand || "";
            }

            item._partType = detectPartType(stockItem);
            seenOwnUnavailable.add(article);
            orderList.push(item);
            continue;
          }

          const existing=orderByArticle.get(article);
          const item=existing
            ? {...existing,_order:true,_order_brand:existing.manufacturer_parts||row.brand||"",_order_oem:row.oem||stockItem.original_number||"",_order_for_article:ownReferenceArticle || stockItem.catalog_number || ""}
            : {_order:true,_order_brand:row.brand||"",_order_oem:row.oem||stockItem.original_number||"",_order_for_article:ownReferenceArticle || stockItem.catalog_number || "",catalog_number:row.article,manufacturer_parts:row.brand||"",name:row.article,original_number:row.oem||"",quantity:0,price:""};
          item._partType = detectPartType(stockItem);
          seenOrder.add(article);
          orderList.push(item);
        }
      }
    }

    const list=[...stockList,...orderList];
    const titleParts=[$("#brand")?.value,m,selectedYear,selectedVolume?(selectedVolume+" л"):"",selectedEngine].filter(Boolean);
    render(list,"Подбор: "+titleParts.join(" · "), true);

    setTimeout(()=>document.querySelector(".results-section")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  } finally {
    loading?.stop();
  }
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
$("#brand").onchange=()=>{
  populateModels(true);
};
$("#model").onchange=()=>{
  populateCarFilters();
};
$("#year").onchange=()=>{};
$("#volume").onchange=()=>{};

$("#partTypeFilter").onchange=()=>{
  activePartType = String($("#partTypeFilter")?.value || "");
  render(lastRenderedList, $("#resultTitle")?.dataset.baseTitle || "Каталог склада");
};

$("#clearBtn").onclick=()=>{
  if($("#brand")) $("#brand").value="";
  if($("#model")) $("#model").value="";
  if($("#year")) $("#year").value="";
  if($("#volume")) $("#volume").value="";
  if($("#fuel")) $("#fuel").value="";
  if($("#body")) $("#body").value="";
  if($("#partTypeFilter")) $("#partTypeFilter").value="";
  activePartType = "";
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

