(() => {
  // Быстрый запуск AMP Auto:
  // полный каталог и кроссы один раз сохраняются в IndexedDB.
  // При следующих заходах они берутся локально, а сервер проверяется в фоне.
  const VERSION = "20261006-idb-v3";
  const DB_NAME = "amp_auto_cache";
  const DB_VERSION = 2;
  const CATALOG_STORE = "catalog";
  const CROSS_STORE = "crosses";
  const ORDER_STORE = "orders";

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
      manufacturer_parts: r.p || "",
      name: r.n || "",
      description: r.d || "",
      quantity: r.q ?? "",
      price: r.pr ?? "",
      original_number: r.o || "",
      marks: r.b || "",
      models: r.m || "",
      engine: r.e || "",
      image: r.i || "",
      source: "catalog"
    };
  }

  async function downloadCatalog(manifest) {
    const rows = [];
    const count = Number(manifest.chunks || 0);

    for (let i = 0; i < count; i++) {
      const name = "catalog/catalog-" + String(i).padStart(2, "0") + ".json";
      const res = await fetch(name + "?v=" + VERSION, { cache: "force-cache" });
      if (!res.ok) throw new Error(name + ": HTTP " + res.status);
      const part = await res.json();
      if (Array.isArray(part)) {
        for (const row of part) rows.push(unpack(row));
      }
    }
    return rows;
  }

  function unpackOrder(r) {
    return {
      catalog_number: r.c || "",
      manufacturer_parts: r.p || "",
      name: r.n || "",
      description: "",
      quantity: 0,
      price: r.pr ?? "",
      original_number: "",
      marks: "",
      models: "",
      engine: "",
      image: "",
      source: "order",
      _order: true,
      _order_brand: r.p || "",
      _order_oem: ""
    };
  }

  async function downloadOrders(manifest) {
    const rows = [];
    const count = Number(manifest.chunks || 0);
    for (let i = 0; i < count; i++) {
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
  }

  function installOrders(rows, silent = false) {
    orderCatalog = Array.isArray(rows) ? rows : [];
    window.orderCatalog = orderCatalog;
    if (!silent && typeof searchParts === "function") {
      render(catalog.slice(0, 100), "Каталог склада");
    }
  }

  async function downloadCrossDatabase(manifest) {
    const by_oem = {};
    const by_article = {};
    const count = Number(manifest.chunks || 0);

    for (let i = 0; i < count; i++) {
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
          brand: x.b || "",
          oem: x.o || "",
          oem_brand: x.ob || ""
        };
        if (oem) (by_oem[oem] ||= []).push(row);
        if (article) (by_article[article] ||= []).push(row);
      }
    }
    return { by_oem, by_article };
  }

  function installCatalog(rows, silent = false) {
    catalog = rows;

    catalogForCar = function(brand = "", model = "", engine = "") {
      const b = norm(brand);
      const m = norm(model);
      const e = norm(engine);
      return catalog.filter(item =>
        hasValue(item.marks, b) &&
        hasValue(item.models, m) &&
        hasValue(item.engine, e)
      );
    };

    initStats();
    populateBrands();
    if (!silent) render(catalog.slice(0, 100), "Каталог товаров");
  }

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
      })());
    }

    // Склад и кроссы критичны для первого экрана.
    // Огромный прайс под заказ грузим отдельно, не блокируя запуск сайта.
    await Promise.all(tasks);
    return true;
  }

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
      try {
        const key = orderKey(activeOrderManifest);
        const cached = await idbGet(ORDER_STORE, key);

        let rows = cached && Array.isArray(cached.rows)
          ? cached.rows
          : await downloadOrders(activeOrderManifest);

        // Даём браузеру отрисовать интерфейс между большими порциями.
        // Если прайс свежий — сохраняем его, но не блокируем UI.
        if (!cached) {
          await idbPut(ORDER_STORE, {
            key,
            version: activeOrderManifest.version,
            rows
          });
        }

        installOrders(rows, true);
        window.orderReady = Promise.resolve(true);
        return true;
      } catch (e) {
        console.warn("AMP Auto lazy order catalog load:", e);
        window.orderReady = Promise.resolve(false);
        return false;
      }
    })();

    return orderLoadPromise;
  }

  window.ensureOrderCatalog = ensureOrderCatalog;

  window.fullCatalogReady = (async () => {
    try {
      // Manifest'ы маленькие — их проверяем всегда, сам каталог нет.
      const [manifest, crossManifest, orderManifest] = await Promise.all([
        getManifest("catalog/manifest.json"),
        getManifest("crosses/manifest.json"),
        getManifest("orders/manifest.json")
      ]);
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

      await refreshIfNeeded(manifest, crossManifest, orderManifest);
      return true;
    } catch (e) {
      console.error("AMP Auto catalog cache failed:", e);
      toast("⚠️ Не удалось загрузить каталог");
      return false;
    }
  })();
})();