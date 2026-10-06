(() => {
  const VERSION = "20261006-full";

  async function getManifest(path) {
    const res = await fetch(path + "?v=" + VERSION, { cache: "no-store" });
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    return res.json();
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

  async function loadCatalog() {
    const manifest = await getManifest("catalog/manifest.json");
    const count = Number(manifest.chunks || 0);

    if (!count) {
      throw new Error("Каталог: manifest не содержит chunks");
    }

    const rows = [];

    for (let i = 0; i < count; i++) {
      const name = "catalog/catalog-" + String(i).padStart(2, "0") + ".json";
      const res = await fetch(name + "?v=" + VERSION, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(name + ": HTTP " + res.status);
      }

      const part = await res.json();

      if (Array.isArray(part)) {
        for (const row of part) {
          rows.push(unpack(row));
        }
      }
    }

    return rows;
  }

  async function loadCrossDatabase() {
    const manifest = await getManifest("crosses/manifest.json");
    const count = Number(manifest.chunks || 0);

    if (!count) {
      throw new Error("Кроссы: manifest не содержит chunks");
    }

    const by_oem = {};
    const by_article = {};

    for (let i = 0; i < count; i++) {
      const name = "crosses/cross-" + String(i).padStart(2, "0") + ".json";
      const res = await fetch(name + "?v=" + VERSION, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(name + ": HTTP " + res.status);
      }

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

        if (oem) {
          (by_oem[oem] ||= []).push(row);
        }

        if (article) {
          (by_article[article] ||= []).push(row);
        }
      }
    }

    window.crossData = { by_oem, by_article };
    return window.crossData;
  }

  function installFullCatalog(rows) {
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
    render(catalog.slice(0, 100), "Каталог товаров");

    toast("✅ Загружено товаров: " + catalog.length.toLocaleString("ru-RU"));
  }

  window.fullCatalogReady = (async () => {
    try {
      await loadCrossDatabase();
      window.crossReady = Promise.resolve(true);
    } catch (e) {
      console.error("Cross database load failed:", e);
      window.crossData = { by_oem: {}, by_article: {} };
      window.crossReady = Promise.resolve(false);
    }

    try {
      const rows = await loadCatalog();
      installFullCatalog(rows);
      return true;
    } catch (e) {
      console.error("Full catalog load failed:", e);
      toast("⚠️ Не удалось загрузить каталог");
      return false;
    }
  })();
})();