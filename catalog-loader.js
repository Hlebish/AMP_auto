(() => {
  // Быстрый запуск AMP Auto:
  // полный каталог и кроссы один раз сохраняются в IndexedDB.
  // При следующих заходах они берутся локально, а сервер проверяется в фоне.
  const VERSION = "20261007-normalized-v13";
  const DB_NAME = "amp_auto_cache";
  const DB_VERSION = 4;
  const CATALOG_STORE = "catalog";
  const CROSS_STORE = "crosses";
  const ORDER_STORE = "orders";
  const IMPORT_STORE = "imports";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CATALOG_STORE)) {
          db.createObjectStore(CATALOG_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(CROSS_STORE)) {
          db.createObjectStore(CROSS_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(ORDER_STORE)) {
          db.createObjectStore(ORDER_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(IMPORT_STORE)) {
          db.createObjectStore(IMPORT_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(store, key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbPut(store, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  async function getManifest(path) {
    const res = await fetch(path + "?v=" + VERSION + "&t=" + Date.now(), {
      cache: "no-store"
    });
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    return res.json();
  }

  function catalogKey(manifest) {
    return "catalog:" + VERSION + ":" + String(manifest.version || manifest.source || "default");
  }

  function orderKey(manifest) {
    return "orders:" + VERSION + ":" + String(manifest.version || manifest.source || "default");
  }

  function crossKey(manifest) {
    return "crosses:" + VERSION + ":" + String(manifest.version || manifest.source || "default");
  }

  function unpack(r) {
    return {
      catalog_number: r.c || "",
      search_key: compact(r.c || ""),
      manufacturer_parts: r.p || "",
      name: typeof cleanPartName === "function" ? cleanPartName(r.n || "") : r.n || "",
      description: r.d || "",
      quantity: r.q ?? "",
      price: r.pr ?? "",
      original_number: r.o || "",
      original_search_key: compact(r.o || ""),
      marks: r.b || "",
      models: r.m || "",
      engine: r.e || "",
      image: r.i || "",
      source: "catalog"
    };
  }

  async function downloadCatalog(manifest) {
    const loading = window.startAppLoading?.("Загружаем складской каталог…");
    try {
      const rows = [];
      const count = Number(manifest.chunks || 0);

      for (let i = 0; i < count; i++) {
        loading?.setText(
          "Загружаем складской каталог… " +
          Math.min(i + 1, count) + "/" + count
        );

        const name = "catalog/catalog-" + String(i).padStart(2, "0") + ".json";
        const res = await fetch(name + "?v=" + VERSION, { cache: "force-cache" });
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        const part = await res.json();
        if (Array.isArray(part)) {
          for (const row of part) rows.push(unpack(row));
        }
      }
      return rows;
    } finally {
      loading?.stop();
    }
  }

  function isAmpartsManufacturer(value) {
    if (typeof window.isOwnManufacturer === "function") {
      return window.isOwnManufacturer(value);
    }
    const key = compact(value);
    return key === "amparts" || key.startsWith("amparts");
  }

  function unpackOrder(r) {
    const amp = isAmpartsManufacturer(r.p || "");
    return {
      catalog_number: r.c || "",
      search_key: compact(r.c || ""),
      manufacturer_parts: r.p || "",
      name: r.n || "",
      description: "",
      quantity: 0,
      price: r.pr ?? "",
      original_number: r.o || "",
      original_search_key: compact(r.o || ""),
      marks: "",
      models: "",
      engine: "",
      image: "",
      source: amp ? "amparts" : "order",
      _order: !amp,
      _unavailable: amp,
      _amparts: amp,
      _order_brand: r.p || "",
      _order_oem: ""
    };
  }

  async function downloadOrders(manifest) {
    const loading = window.startAppLoading?.("Загружаем прайс под заказ…");
    try {
      const rows = [];
      const count = Number(manifest.chunks || 0);
      for (let i = 0; i < count; i++) {
        loading?.setText(
          "Загружаем прайс под заказ… " +
          Math.min(i + 1, count) + "/" + count
        );

        const name = "orders/order-" + String(i).padStart(3, "0") + ".json";
        const res = await fetch(name + "?v=" + VERSION, { cache: "force-cache" });
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        const part = await res.json();
        if (Array.isArray(part)) {
          for (const row of part) rows.push(unpackOrder(row));
        }
        // Не держим главный поток занятым всеми 62 чанками подряд.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return rows;
    } finally {
      loading?.stop();
    }
  }

  async function installOrders(rows, silent = false) {
    const allRows = Array.isArray(rows) ? rows : [];
    const stockArticles = new Set(
      catalog
        .filter(item => qtyValue(item.quantity) > 0)
        .map(item => compact(item.catalog_number))
        .filter(Boolean)
    );
    const ownStockArticles = new Set(
      catalog
        .filter(item =>
          qtyValue(item.quantity) > 0 &&
          isAmpartsManufacturer(item.manufacturer_parts || "")
        )
        .map(item => compact(item.catalog_number))
        .filter(Boolean)
    );

    // Это авторитетный список наших артикулов:
    // если артикул есть на нашем складе и производитель AMParts,
    // он НИКОГДА не может превратиться в "под заказ".
    window.ownStockArticles = ownStockArticles;

    const ownUnavailableSeen = new Set();
    const unavailableAmparts = [];

    // ВАЖНО: не удаляем заказную позицию только потому, что такой же
    // артикул уже есть на складе. Поиск по артикулу должен видеть ОБЕ
    // записи: складскую и заказную.
    //
    // При подборе автомобиля заказные дубли всё равно отсекаются
    // в app.js через ownStockArticles, поэтому здесь безопасно хранить
    // полный внешний прайс.
    orderCatalog = allRows.filter(item => {
      const ownByManufacturer =
        isAmpartsManufacturer(item.manufacturer_parts || item._order_brand || "");

      // AMParts никогда не попадает в "ПОД ЗАКАЗ" — его отсутствие
      // обрабатывается отдельно через ampatsUnavailableCatalog.
      if (ownByManufacturer) return false;

      return !item._amparts;
    });

    for (const item of allRows) {
      const key = compact(item.catalog_number);
      const ownByArticle = key && ownStockArticles.has(key);
      const ownByManufacturer =
        item._amparts ||
        isAmpartsManufacturer(item.manufacturer_parts || item._order_brand || "");

      if (!ownByManufacturer || ownByArticle || !key || ownUnavailableSeen.has(key)) {
        continue;
      }

      ownUnavailableSeen.add(key);
      unavailableAmparts.push({
        ...item,
        source: "amparts",
        _order: false,
        _unavailable: true,
        _amparts: true,
        quantity: 0
      });
    }

    window.orderCatalog = orderCatalog;
    window.ampartsUnavailableCatalog = unavailableAmparts;

    // Индексируем только известные типы деталей. Это сильно ускоряет
    // массовые запросы вроде "поршни": вместо прохода по 300k+ строкам
    // поиск получает только подходящую категорию.
    const partTerms = {
      капот: ["капот","капота","капоту","капотом","hood","bonnet"],
      крыло: ["крыло","крыла","крылу","крылом","крылья","крило","wing","fender"],
      бампер: ["бампер","бампера","бамперу","бампером","бамперы","bumper"],
      дверь: ["дверь","двери","дверей","дверью","дверця","door"],
      фара: ["фара","фары","фар","фару","фарами","headlight","headlamp"],
      фонарь: ["фонарь","фонари","фонаря","ліхтар","tail light","taillight"],
      решетка: ["решетка","решётка","решітка","решетки","решітки","grille"],
      пластик: ["пластик","пластика","пластиковый","пластиковая","пластикове","plastic"],
      зеркало: ["зеркало","зеркала","дзеркало","mirror"],
      стекло: ["стекло","стекла","скло","glass"],
      подкрылок: ["подкрылок","подкрылка","подкрылки","підкрилок","fender liner"],
      усилитель: ["усилитель","усилителя","підсилювач","reinforcement"],
      замок: ["замок","замка","замку","lock","latch"],
      ручка: ["ручка","ручки","ручку","handle"],
      молдинг: ["молдинг","молдинги","molding"],
      спойлер: ["спойлер","спойлера","spoiler"],
      крышка: ["крышка","крышки","крышку","кришка","cover"],
      защита: ["защита","защиты","защиту","захист","guard"],
      подкрыльник: ["подкрыльник","підкрилок","fender liner"],
      поршень: ["поршень","поршни","поршня","поршней","поршнями","piston","pistons"],
      колодка: ["колодка","колодки","тормозная колодка","brake pad"],
      диск: ["диск","диски","тормозной диск","brake disc"],
      фильтр: ["фильтр","фильтры","filter"],
      свеча: ["свеча","свечи","свеча зажигания","spark plug"]
    };

    const index = {};
    for (const key of Object.keys(partTerms)) index[key] = [];

    // Индекс брендов нужен для запросов вроде "Nissan Rogue":
    // после загрузки прайса не заставляем поиск каждый раз сканировать
    // все ~300k строк.
    const brandTerms = {
      bmw:["bmw","бмв"], audi:["audi","ауди","ауді"],
      mercedes:["mercedes","мерседес","mb"], volkswagen:["volkswagen","фольксваген","vw"],
      toyota:["toyota","тойота"], honda:["honda","хонда"], mazda:["mazda","мазда"],
      ford:["ford","форд"], nissan:["nissan","ниссан","ніссан"], renault:["renault","рено"],
      skoda:["skoda","шкода"], hyundai:["hyundai","хендай","хюндай"], kia:["kia","киа","кіа"],
      mitsubishi:["mitsubishi","митсубиси","мітсубісі"], opel:["opel","опель"],
      peugeot:["peugeot","пежо"], citroen:["citroen","ситроен","сітроен"],
      chevrolet:["chevrolet","шевроле","chevy"], lexus:["lexus","лексус"],
      subaru:["subaru","субару"], volvo:["volvo","вольво"], jaguar:["jaguar","ягуар"],
      jeep:["jeep","джип"]
    };
    const brandIndex = {};
    for (const key of Object.keys(brandTerms)) brandIndex[key] = [];

    // Один проход по прайсу вместо 24+ * 300k проверок.
    // Ищем термины через нормализованный текст, но разбираем список
    // терминов один раз и не пересчитываем norm() внутри вложенных циклов.
    const normalizedPartTerms = Object.fromEntries(
      Object.entries(partTerms).map(([key, terms]) => [
        key,
        terms.map(term => norm(term)).filter(Boolean)
      ])
    );
    const normalizedBrandTerms = Object.fromEntries(
      Object.entries(brandTerms).map(([key, terms]) => [
        key,
        terms.map(term => norm(term)).filter(Boolean)
      ])
    );

    for (let i = 0; i < orderCatalog.length; i++) {
      const item = orderCatalog[i];
      const text = norm([
        item.name,
        item.description,
        item.manufacturer_parts
      ].filter(Boolean).join(" "));
      if (text) {
        for (const [key, terms] of Object.entries(normalizedPartTerms)) {
          if (terms.some(term => text.includes(term))) index[key].push(item);
        }

        for (const [key, terms] of Object.entries(normalizedBrandTerms)) {
          if (terms.some(term => text.includes(term))) brandIndex[key].push(item);
        }
      }

      // Не блокируем главный поток на сотни тысяч строк.
      if ((i + 1) % 1000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    window.orderPartIndex = index;
    window.orderBrandIndex = brandIndex;

    if (!silent && typeof searchParts === "function") {
      render(catalog.slice(0, 100), "Каталог склада");
    }
  }

  async function downloadCrossDatabase(manifest) {
    const loading = window.startAppLoading?.("Загружаем базу кроссов…");
    try {
      const by_oem = {};
      const by_article = {};
      const count = Number(manifest.chunks || 0);

      for (let i = 0; i < count; i++) {
        loading?.setText(
          "Загружаем базу кроссов… " +
          Math.min(i + 1, count) + "/" + count
        );

        const name = "crosses/cross-" + String(i).padStart(2, "0") + ".json";
        const res = await fetch(name + "?v=" + VERSION, { cache: "force-cache" });
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        const part = await res.json();
        if (!Array.isArray(part)) continue;

        for (const x of part) {
          const oem = compact(x.o || "");
          const article = compact(x.a || "");
          const row = {
            article: x.a || "",
            article_key: article,
            brand: x.b || "",
            oem: x.o || "",
            oem_key: oem,
            oem_brand: x.ob || ""
          };
          if (oem) (by_oem[oem] ||= []).push(row);
          if (article) (by_article[article] ||= []).push(row);
        }
      }
      return { by_oem, by_article };
    } finally {
      loading?.stop();
    }
  }

  function installCatalog(rows, silent = false) {
    catalog = rows;
    window.currentCatalog = catalog;

    // Сразу фиксируем наши реальные AMParts-артикулы из склада.
    // Это нужно ещё до загрузки огромного прайса под заказ, чтобы кроссы
    // не смогли временно показать наш товар как "ПОД ЗАКАЗ".
    window.ownStockArticles = new Set(
      catalog
        .filter(item =>
          qtyValue(item.quantity) > 0 &&
          isAmpartsManufacturer(item.manufacturer_parts || "")
        )
        .map(item => compact(item.catalog_number))
        .filter(Boolean)
    );

    catalogForCar = function(brand = "", model = "", engine = "") {
      const b = norm(brand);
      const e = norm(engine);
      return catalog.filter(item =>
        hasValue(item.marks, b) &&
        modelMatches(item, model) &&
        hasValue(item.engine, e)
      );
    };

    initStats();

    // Не перестраиваем <select> марки прямо во время его открытия:
    // браузер закрывает native dropdown при замене его options.
    // Каталог при этом уже обновлён, а следующий выбор/подбор использует
    // новые данные без принудительного закрытия меню.
    const brandEl = $("#brand");
    if (!(silent && brandEl && document.activeElement === brandEl)) {
      populateBrands(true);
    }

    if (!silent) render(catalog.slice(0, 100), "Каталог товаров");
  }

  function importedKey(value) {
    return typeof window.normalizePartNumber === "function"
      ? window.normalizePartNumber(value)
      : String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function mergeImportedRows(baseRows, importedRows, mode = "update") {
    const base = Array.isArray(baseRows) ? baseRows.map(x => ({...x})) : [];
    const incoming = Array.isArray(importedRows) ? importedRows : [];
    const byArticle = new Map();

    for (let i = 0; i < base.length; i++) {
      const k = importedKey(base[i].catalog_number);
      if (k && !byArticle.has(k)) byArticle.set(k, []);
      if (k) byArticle.get(k).push(i);
    }

    const seenIncoming = new Set();
    let added = 0;
    let updated = 0;

    const fields = [
      "manufacturer_parts","name","description","quantity","price",
      "original_number","marks","models","engine","image"
    ];

    for (const raw of incoming) {
      const article = String(raw?.catalog_number ?? "").trim();
      const k = importedKey(article);
      if (!k) continue;
      seenIncoming.add(k);

      const indexes = byArticle.get(k) || [];
      if (indexes.length && mode !== "append") {
        for (const idx of indexes) {
          const target = base[idx];
          for (const field of fields) {
            const value = raw[field];
            if (value !== "" && value !== null && value !== undefined) {
              target[field] = value;
            }
          }
          target.catalog_number = target.catalog_number || article;
          target.search_key = importedKey(target.catalog_number);
          target.original_search_key = importedKey(target.original_number || "");
          updated++;
        }
      } else if (!indexes.length) {
        const row = {
          catalog_number: article,
          search_key: k,
          manufacturer_parts: raw.manufacturer_parts || "",
          name: raw.name || "",
          description: raw.description || "",
          quantity: raw.quantity ?? "",
          price: raw.price ?? "",
          original_number: raw.original_number || "",
          original_search_key: importedKey(raw.original_number || ""),
          marks: raw.marks || "",
          models: raw.models || "",
          engine: raw.engine || "",
          image: raw.image || "",
          source: "import"
        };
        base.push(row);
        byArticle.set(k, [base.length - 1]);
        added++;
      }
    }

    if (mode === "replace") {
      for (const row of base) {
        const k = importedKey(row.catalog_number);
        if (!k || seenIncoming.has(k)) continue;
        if (qtyValue(row.quantity) > 0) {
          row.quantity = 0;
          updated++;
        }
      }
    }

    return { rows: base, added, updated };
  }

  window.getImportedCatalogState = async function() {
    return getImportedState();
  };

  window.mergeImportedCatalogRows = function(baseRows, incomingRows) {
    return mergeImportedRows(baseRows, incomingRows, "update").rows;
  };

  async function getImportedState() {
    try {
      return await idbGet(IMPORT_STORE, "custom");
    } catch (e) {
      console.warn("AMP Auto import cache:", e);
      return null;
    }
  }

  async function getGlobalImportState() {
    try {
      // AMP Auto работает через GitHub Pages, поэтому Firebase Hosting
      // endpoint /__/firebase/init.json здесь не существует и давал 404.
      // Используем тот же публичный Firebase Storage bucket напрямую.
      const storageBucket = "amp-auto.firebasestorage.app";
      const url =
        "https://firebasestorage.googleapis.com/v0/b/" +
        encodeURIComponent(storageBucket) +
        "/o/" + encodeURIComponent("catalog/imports/current.json") +
        "?alt=media&t=" + Date.now();

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;

      const data = await res.json();
      return Array.isArray(data?.rows) ? data : null;
    } catch (e) {
      console.warn("AMP Auto global import:", e);
      return null;
    }
  }

  async function installGlobalImportState(baseRows, silent = true) {
    const state = await getGlobalImportState();
    if (!state?.rows?.length) return baseRows;
    const merged = mergeImportedRows(baseRows, state.rows, state.mode || "update");
    installCatalog(merged.rows, silent);
    return merged.rows;
  }

  async function installImportedState(baseRows, silent = true) {
    const state = await getImportedState();
    if (!state || !Array.isArray(state.rows) || !state.rows.length) return baseRows;
    const merged = mergeImportedRows(baseRows, state.rows, state.mode || "update");
    if (merged.rows.length) {
      installCatalog(merged.rows, silent);
      return merged.rows;
    }
    return baseRows;
  }

  window.applyImportedCatalog = async function(rows, mode = "update", meta = {}) {
    const incoming = Array.isArray(rows) ? rows : [];
    if (!incoming.length) return { ok:false, error:"Excel не содержит товаров" };

    const current = Array.isArray(catalog) ? catalog : [];
    const merged = mergeImportedRows(current, incoming, mode);

    const previous = await getImportedState();
    let persistedRows = incoming;
    if (previous && Array.isArray(previous.rows) && mode !== "replace") {
      persistedRows = mergeImportedRows(previous.rows, incoming, "update").rows;
    }

    await idbPut(IMPORT_STORE, {
      key: "custom",
      version: Date.now(),
      mode,
      rows: persistedRows,
      filename: meta.filename || previous?.filename || "",
      importedAt: meta.importedAt || new Date().toISOString()
    });

    installCatalog(merged.rows, true);
    window.currentCatalog = catalog;

    return {
      ok: true,
      added: merged.added,
      updated: merged.updated,
      total: merged.rows.length
    };
  };

  function installCrosses(data) {
    window.crossData = data || { by_oem: {}, by_article: {} };
  }

  async function useCache(manifest, crossManifest, orderManifest) {
    const [cachedCatalog, cachedCrosses, cachedOrders] = await Promise.all([
      idbGet(CATALOG_STORE, catalogKey(manifest)),
      idbGet(CROSS_STORE, crossKey(crossManifest)),
      idbGet(ORDER_STORE, orderKey(orderManifest))
    ]);

    if (!cachedCatalog || !Array.isArray(cachedCatalog.rows)) return false;

    installCatalog(cachedCatalog.rows, true);
    await installImportedState(catalog, true);
    await installGlobalImportState(catalog, true);

    // Прайс под заказ НЕ разворачиваем при старте: даже чтение 300k
    // объектов из IndexedDB заметно подвешивает интерфейс.
    window.orderCatalog = [];
    orderCatalog = [];
    window.orderReady = Promise.resolve(false);

    if (cachedCrosses && cachedCrosses.data) {
      installCrosses(cachedCrosses.data);
      window.crossReady = Promise.resolve(true);
    } else {
      window.crossReady = Promise.resolve(false);
    }

    return true;
  }

  async function refreshIfNeeded(manifest, crossManifest, orderManifest) {
    const cKey = catalogKey(manifest);
    const xKey = crossKey(crossManifest);
    const oKey = orderKey(orderManifest);

    const [cachedCatalog, cachedCrosses, cachedOrders] = await Promise.all([
      idbGet(CATALOG_STORE, cKey),
      idbGet(CROSS_STORE, xKey),
      idbGet(ORDER_STORE, oKey)
    ]);

    const tasks = [];

    if (!cachedCatalog) {
      tasks.push((async () => {
        const rows = await downloadCatalog(manifest);
        await idbPut(CATALOG_STORE, { key: cKey, version: manifest.version, rows });
        installCatalog(rows, true);
        await installImportedState(catalog, true);
        await installGlobalImportState(catalog, true);
      })());
    }

    // Заказной каталог грузится только при поиске.
    // Это критично: 307k строк нельзя разбирать на старте страницы.

    if (!cachedCrosses) {
      tasks.push((async () => {
        const data = await downloadCrossDatabase(crossManifest);
        await idbPut(CROSS_STORE, { key: xKey, version: crossManifest.version, data });
        installCrosses(data);
        window.crossReady = Promise.resolve(true);
        return true;
      })());
    }

    // Склад и кроссы критичны для первого экрана.
    // Огромный прайс под заказ грузим отдельно, не блокируя запуск сайта.
    await Promise.all(tasks);
    return true;
  }

  let crossLoadPromise = null;
  let activeCrossManifest = null;
  let orderLoadPromise = null;
  let activeOrderManifest = null;

  async function ensureOrderCatalog() {
    if (Array.isArray(window.orderCatalog) && window.orderCatalog.length) return true;
    if (orderLoadPromise) return orderLoadPromise;

    if (!activeOrderManifest) {
      try {
        activeOrderManifest = await getManifest("orders/manifest.json");
      } catch (e) {
        console.warn("AMP Auto order manifest:", e);
        return false;
      }
    }

    orderLoadPromise = (async () => {
      let loading = null;

      try {
        const key = orderKey(activeOrderManifest);
        const cached = await idbGet(ORDER_STORE, key);

        // Если полный прайс уже лежит в IndexedDB, НИЧЕГО не скачиваем.
        // Берём его локально и не показываем пользователю загрузчик 62/62.
        if (cached && Array.isArray(cached.rows) && cached.rows.length) {
          await installOrders(cached.rows, true);
          window.orderReady = Promise.resolve(true);
          return true;
        }

        // Первый запуск или новая версия прайса — скачиваем один раз
        // и после этого сохраняем весь прайс в локальную базу.
        loading = window.startAppLoading?.("Загружаем прайс под заказ…");

        const rows = await downloadOrders(activeOrderManifest);

        loading?.setText("Сохраняем прайс в локальную базу…");
        await idbPut(ORDER_STORE, {
          key,
          version: activeOrderManifest.version,
          rows
        });

        loading?.setText("Индексируем товары под заказ…");
        await installOrders(rows, true);
        window.orderReady = Promise.resolve(true);
        return true;
      } catch (e) {
        console.warn("AMP Auto lazy order catalog load:", e);
        window.orderReady = Promise.resolve(false);
        return false;
      } finally {
        loading?.stop();
      }
    })();

    return orderLoadPromise;
  }
  window.ensureOrderCatalog = ensureOrderCatalog;

  async function ensureCrossDatabase() {
    if (window.crossData &&
        window.crossData.by_oem &&
        Object.keys(window.crossData.by_oem).length) {
      return true;
    }
    if (crossLoadPromise) return crossLoadPromise;

    const loading = window.startAppLoading?.("Готовим базу кроссов…");

    if (!activeCrossManifest) {
      try {
        activeCrossManifest = await getManifest("crosses/manifest.json");
      } catch (e) {
        loading?.stop();
        console.warn("AMP Auto cross manifest:", e);
        return false;
      }
    }

    crossLoadPromise = (async () => {
      try {
        const key = crossKey(activeCrossManifest);
        const cached = await idbGet(CROSS_STORE, key);
        loading?.setText(
          cached
            ? "Загружаем базу кроссов из кэша…"
            : "Загружаем базу кроссов…"
        );

        let data = cached && cached.data
          ? cached.data
          : await downloadCrossDatabase(activeCrossManifest);

        if (!cached) {
          loading?.setText("Сохраняем базу кроссов…");
          await idbPut(CROSS_STORE, {
            key,
            version: activeCrossManifest.version,
            data
          });
        }

        installCrosses(data);
        window.crossReady = Promise.resolve(true);
        return true;
      } catch (e) {
        console.warn("AMP Auto cross database load:", e);
        window.crossReady = Promise.resolve(false);
        return false;
      } finally {
        loading?.stop();
      }
    })();

    return crossLoadPromise;
  }

  window.ensureCrossDatabase = ensureCrossDatabase;

  const bootLoading = window.startAppLoading?.("Проверяем каталог…");

  window.fullCatalogReady = (async () => {
    try {
      // Manifest'ы маленькие — их проверяем всегда, сам каталог нет.
      const [manifest, crossManifest, orderManifest] = await Promise.all([
        getManifest("catalog/manifest.json"),
        getManifest("crosses/manifest.json"),
        getManifest("orders/manifest.json")
      ]);
      activeCrossManifest = crossManifest;
      activeOrderManifest = orderManifest;

      const cached = await useCache(manifest, crossManifest, orderManifest);

      // Если кэш есть — сайт уже работает. Обновление делаем в фоне.
      if (cached) {
        window.fullCatalogReady = Promise.resolve(true);
        refreshIfNeeded(manifest, crossManifest, orderManifest).catch(e =>
          console.warn("AMP Auto background cache refresh:", e)
        );
        return true;
      }

      bootLoading?.setText("Загружаем каталог…");
      await refreshIfNeeded(manifest, crossManifest, orderManifest);
      return true;
    } catch (e) {
      console.error("AMP Auto catalog cache failed:", e);
      toast("⚠️ Не удалось загрузить каталог");
      return false;
    } finally {
      bootLoading?.stop();
    }
  })();
})();