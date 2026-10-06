(() => {
  // Быстрый запуск AMP Auto:
  // полный каталог и кроссы один раз сохраняются в IndexedDB.
  // При следующих заходах они берутся локально, а сервер проверяется в фоне.
  const VERSION = "20261006-idb-v1";
  const DB_NAME = "amp_auto_cache";
  const DB_VERSION = 1;
  const CATALOG_STORE = "catalog";
  const CROSS_STORE = "crosses";

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
    return "catalog:" + String(manifest.version || manifest.source || "default");
  }

  function crossKey(manifest) {
    return "crosses:" + String(manifest.version || manifest.source || "default");
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

  async function useCache(manifest, crossManifest) {
    const [cachedCatalog, cachedCrosses] = await Promise.all([
      idbGet(CATALOG_STORE, catalogKey(manifest)),
      idbGet(CROSS_STORE, crossKey(crossManifest))
    ]);

    if (!cachedCatalog || !Array.isArray(cachedCatalog.rows)) return false;

    installCatalog(cachedCatalog.rows, true);

    if (cachedCrosses && cachedCrosses.data) {
      installCrosses(cachedCrosses.data);
      window.crossReady = Promise.resolve(true);
    } else {
      window.crossReady = Promise.resolve(false);
    }

    return true;
  }

  async function refreshIfNeeded(manifest, crossManifest) {
    const cKey = catalogKey(manifest);
    const xKey = crossKey(crossManifest);

    const [cachedCatalog, cachedCrosses] = await Promise.all([
      idbGet(CATALOG_STORE, cKey),
      idbGet(CROSS_STORE, xKey)
    ]);

    const tasks = [];

    if (!cachedCatalog) {
      tasks.push((async () => {
        const rows = await downloadCatalog(manifest);
        await idbPut(CATALOG_STORE, { key: cKey, version: manifest.version, rows });
        installCatalog(rows, true);
      })());
    }

    if (!cachedCrosses) {
      tasks.push((async () => {
        const data = await downloadCrossDatabase(crossManifest);
        await idbPut(CROSS_STORE, { key: xKey, version: crossManifest.version, data });
        installCrosses(data);
        window.crossReady = Promise.resolve(true);
      })());
    }

    await Promise.all(tasks);
    return true;
  }

  window.fullCatalogReady = (async () => {
    try {
      // Manifest'ы маленькие — их проверяем всегда, сам каталог нет.
      const [manifest, crossManifest] = await Promise.all([
        getManifest("catalog/manifest.json"),
        getManifest("crosses/manifest.json")
      ]);

      const cached = await useCache(manifest, crossManifest);

      // Если кэш есть — сайт уже работает. Обновление делаем в фоне.
      if (cached) {
        window.fullCatalogReady = Promise.resolve(true);
        refreshIfNeeded(manifest, crossManifest).catch(e =>
          console.warn("AMP Auto background cache refresh:", e)
        );
        return true;
      }

      await refreshIfNeeded(manifest, crossManifest);
      return true;
    } catch (e) {
      console.error("AMP Auto catalog cache failed:", e);
      toast("⚠️ Не удалось загрузить каталог");
      return false;
    }
  })();
})();