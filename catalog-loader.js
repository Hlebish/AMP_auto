(() => {
  const CHUNK_COUNT = 19;
  const CACHE_KEY = "amp_auto_full_catalog_v1";

  function unpack(rows) {
    return rows.map(r => ({
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
    }));
  }

  async function loadChunk(i) {
    const res = await fetch("catalog/catalog-" + String(i).padStart(2, "0") + ".json?v=20261006", {
      cache: "no-store"
    });
    if (!res.ok) throw new Error("Каталог: HTTP " + res.status);
    return unpack(await res.json());
  }

  async function loadCrossDatabase() {
    const parts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        fetch("crosses/cross-" + String(i).padStart(2, "0") + ".json?v=20261006", { cache: "no-store" })
          .then(r => { if (!r.ok) throw new Error("Кроссы: HTTP " + r.status); return r.json(); })
      )
    );
    const rows = parts.flat();
    const by_oem = {}, by_article = {};
    for (const x of rows) {
      const oem = compact(x.o || "");
      const article = compact(x.a || "");
      const row = { article: x.a || "", brand: x.b || "", oem: x.o || "", oem_brand: x.ob || "" };
      if (oem) (by_oem[oem] ||= []).push(row);
      if (article) (by_article[article] ||= []).push(row);
    }
    crossData = { by_oem, by_article };
    window.crossData = crossData;
    return true;
  }

  async function loadFullCatalog() {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const rows = JSON.parse(cached);
        if (Array.isArray(rows) && rows.length) return rows;
      } catch (e) {}
    }

    const parts = await Promise.all(
      Array.from({ length: CHUNK_COUNT }, (_, i) => loadChunk(i))
    );
    const rows = parts.flat();
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
    return rows;
  }

  function installFullCatalog(rows) {
    catalog = rows;

    // Подбор автомобиля остаётся только по реальному наличию.
    window.catalogForCar = function(brand = "", model = "", engine = "") {
      const b = norm(brand), m = norm(model), e = norm(engine);
      return stockOnly(catalog).filter(item =>
        hasValue(item.marks, b) &&
        hasValue(item.models, m) &&
        hasValue(item.engine, e)
      );
    };

    // Полный каталог: наличие определяется quantity.
    // Склад всегда выше товаров под заказ.
    window.render = function(list, title = "Каталог") {
      const sorted = [...list].sort((a, b) => {
        const sa = qtyValue(a.quantity) > 0 ? 1 : 0;
        const sb = qtyValue(b.quantity) > 0 ? 1 : 0;
        return sb - sa;
      });
      results = sorted.slice(0, 300);
      $("#resultTitle").textContent = title + (sorted.length > 300 ? " · первые 300" : "");

      if (!sorted.length) {
        $("#results").innerHTML = '<div class="empty">Ничего не найдено.</div>';
        return;
      }

      $("#results").innerHTML = sorted.slice(0, 300).map(x => {
        const inStock = qtyValue(x.quantity) > 0;
        const qty = String(x.quantity ?? "");
        return `
          <article class="result-card ${inStock ? "" : "order-result"}">
            <div>
              <div class="result-name">${escapeHtml(x.name || x.catalog_number)}</div>
              <div class="meta">
                <strong>${escapeHtml(x.catalog_number)}</strong>
                · ${escapeHtml(x.manufacturer_parts || "")}
                <br>
                ${inStock
                  ? '<span class="stock-badge">🟢 НА СКЛАДЕ</span>'
                  : '<span class="order-badge">🟠 ПОД ЗАКАЗ</span>'}
                <br>
                OEM: ${escapeHtml(String(x.original_number || "").split(",").slice(0, 6).join(", "))}
                ${x.marks ? "<br>Авто: " + escapeHtml(x.marks) : ""}
                ${x.models ? " · " + escapeHtml(String(x.models).split(",").slice(0, 3).join(", ")) : ""}
                ${inStock
                  ? '<br><span class="qty">В наличии: ' + escapeHtml(qty) +
                    (x.price ? " · " + Number(x.price).toLocaleString("uk-UA") + " ₴" : "") +
                    "</span>"
                  : '<br><span class="qty">Сейчас нет на складе · можно заказать</span>'}
              </div>
            </div>
          </article>
        `;
      }).join("");
    };

    initStats();
    populateBrands();
    render(catalog.slice(0, 100), "Каталог товаров");
    toast("✅ Загружен полный каталог: " + catalog.length + " товаров");
  }

  window.fullCatalogReady = (async () => {
    try {
      await loadCrossDatabase();
      if (window.crossReady) await window.crossReady;
    } catch (e) {
      console.warn("Cross database load failed:", e);
    }
    try {
      const rows = await loadFullCatalog();
      installFullCatalog(rows);
      return true;
    } catch (e) {
      console.error("Full catalog load failed:", e);
      toast("⚠️ Не удалось загрузить полный каталог");
      return false;
    }
  })();
})();