(() => {
  const CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN;
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error("Не удалось загрузить модуль Excel"));
      document.head.appendChild(script);
    });
  }

  const clean = v => String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const key = v => typeof window.normalizePartNumber === "function"
    ? window.normalizePartNumber(v)
    : clean(v).toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");

  const headerAliases = {
    catalog_number:["артикул","артикул производителя","код","код товара","article","part number","partnumber","catalog_number","c"],
    manufacturer_parts:["производитель","бренд","manufacturer","brand","vendor","p"],
    name:["наименование","название","товар","деталь","name","description","n"],
    description:["описание","description","d"],
    quantity:["остаток","остатки","количество","кол-во","количество на складе","наличие","qty","quantity","q"],
    price:["цена","розничная цена","цена продажи","price","pr"],
    original_number:["oem","оригинал","оригинальный номер","oem номер","oem number","original_number","o"],
    marks:["марка","марки","автомобиль","brand car","marks","b"],
    models:["модель","модели","model","models","m"],
    engine:["двигатель","двигатели","engine","e"],
    image:["изображение","фото","image","img","i"]
  };

  function normalizeHeader(v) {
    return clean(v).toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-яіїєґ0-9]+/g,"");
  }

  function findColumn(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliases) {
      const wanted = normalizeHeader(alias);
      const exact = normalized.indexOf(wanted);
      if (exact >= 0) return exact;
    }
    for (const alias of aliases) {
      const wanted = normalizeHeader(alias);
      const found = normalized.findIndex(h => h.includes(wanted) || wanted.includes(h));
      if (found >= 0) return found;
    }
    return -1;
  }

  function mapRows(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) throw new Error("Excel-файл пустой");
    const headers = matrix[0].map(v => clean(v));
    const cols = {};
    for (const [field, aliases] of Object.entries(headerAliases)) {
      cols[field] = findColumn(headers, aliases);
    }

    if (cols.catalog_number < 0) {
      throw new Error("Не найден столбец «Артикул». Добавь колонку с артикулом товара.");
    }

    const rows = [];
    for (let i = 1; i < matrix.length; i++) {
      const src = matrix[i] || [];
      const article = clean(src[cols.catalog_number]);
      if (!article) continue;

      const row = {
        catalog_number: article,
        manufacturer_parts: cols.manufacturer_parts >= 0 ? clean(src[cols.manufacturer_parts]) : "",
        name: cols.name >= 0 ? clean(src[cols.name]) : "",
        description: cols.description >= 0 ? clean(src[cols.description]) : "",
        quantity: cols.quantity >= 0 ? src[cols.quantity] : "",
        price: cols.price >= 0 ? src[cols.price] : "",
        original_number: cols.original_number >= 0 ? clean(src[cols.original_number]) : "",
        marks: cols.marks >= 0 ? clean(src[cols.marks]) : "",
        models: cols.models >= 0 ? clean(src[cols.models]) : "",
        engine: cols.engine >= 0 ? clean(src[cols.engine]) : "",
        image: cols.image >= 0 ? clean(src[cols.image]) : ""
      };

      if (row.quantity !== "" && row.quantity != null) {
        const q = String(row.quantity).trim().replace(",", ".");
        if (/^5\+$/.test(q)) row.quantity = "5+";
        else if (/^-?\d+(\.\d+)?$/.test(q)) row.quantity = Number(q);
      }

      rows.push(row);
    }

    return { headers, rows, columns: cols };
  }

  async function readFile(file) {
    const XLSX = await loadXlsx();
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type:"array", cellDates:false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header:1, defval:"" });
    return mapRows(matrix);
  }

  function renderPreview(info, mode) {
    const box = document.querySelector("#importPreview");
    if (!box) return;
    const rows = info.rows;
    const existing = new Set(
      (window.currentCatalog || []).map(x => key(x.catalog_number)).filter(Boolean)
    );
    const newCount = rows.filter(x => !existing.has(key(x.catalog_number))).length;
    const updateCount = rows.length - newCount;

    box.classList.remove("hidden");
    box.innerHTML =
      "<b>Предпросмотр</b>" +
      "<div class=\"import-stats\">" +
      "<span>Строк: <b>" + rows.length.toLocaleString("ru-RU") + "</b></span>" +
      "<span>Новых: <b>" + newCount.toLocaleString("ru-RU") + "</b></span>" +
      "<span>Обновится: <b>" + updateCount.toLocaleString("ru-RU") + "</b></span>" +
      "</div>" +
      "<div class=\"import-samples\">" +
      rows.slice(0,5).map(x =>
        "<div><b>" + escapeHtml(x.catalog_number) + "</b> — " +
        escapeHtml(x.name || "без названия") +
        (x.quantity !== "" ? " · остаток: " + escapeHtml(x.quantity) : "") +
        "</div>"
      ).join("") +
      "</div>" +
      "<small>Режим: " + escapeHtml(modeLabel(mode)) + "</small>";
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
  }

  function modeLabel(mode) {
    return mode === "replace" ? "Полная замена остатков" :
      mode === "append" ? "Только новые товары" :
      "Обновить и дополнить";
  }

  async function firebaseApp() {
    if (!window.firebase) throw new Error("Firebase SDK не загружен");
    const cfgRes = await fetch("/__/firebase/init.json", { cache:"no-store" });
    if (!cfgRes.ok) throw new Error("Не найден Firebase Hosting init.json");
    const config = await cfgRes.json();
    if (!firebase.apps.length) firebase.initializeApp(config);
    if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
    return firebase.app();
  }

  async function publishSelected() {
    const input = document.querySelector("#excelImportInput");
    const mode = document.querySelector("#excelImportMode")?.value || "update";
    const file = input?.files?.[0];
    if (!file) {
      window.toast?.("Выбери Excel-файл");
      return;
    }

    const loading = window.startAppLoading?.("Готовим общий прайс…");
    try {
      const info = await readFile(file);
      if (mode === "replace" && !confirm(
        "Опубликовать полную замену остатков для ВСЕХ пользователей?\n\n" +
        "Позиции, которых нет в файле, будут иметь остаток 0."
      )) return;

      loading?.setText("Собираем общий каталог…");
      const existing = await window.getImportedCatalogState?.();
      let rows = info.rows;
      if (existing?.rows?.length && mode !== "replace") {
        const merged = window.mergeImportedCatalogRows(existing.rows, info.rows);
        rows = merged;
      }

      const app = await firebaseApp();
      const payload = {
        mode,
        rows,
        filename: file.name,
        importedAt: new Date().toISOString()
      };

      loading?.setText("Публикуем изменения…");
      await app.storage().ref("catalog/imports/current.json")
        .putString(JSON.stringify(payload), "raw", {
          contentType: "application/json",
          cacheControl: "no-cache, max-age=0"
        });

      if (window.applyImportedCatalog) {
        await window.applyImportedCatalog(info.rows, mode, {
          filename:file.name,
          importedAt:payload.importedAt
        });
      }

      window.toast?.("🌍 Готово — общий прайс опубликован для всех пользователей");
    } catch (e) {
      console.error("AMP Auto shared Excel publish:", e);
      window.toast?.("❌ " + (e.message || "Не удалось опубликовать"));
    } finally {
      loading?.stop();
    }
  }

  async function importSelected() {
    const input = document.querySelector("#excelImportInput");
    const mode = document.querySelector("#excelImportMode")?.value || "update";
    const file = input?.files?.[0];
    if (!file) {
      window.toast?.("Выбери Excel-файл");
      return;
    }

    const loading = window.startAppLoading?.("Читаем Excel…");
    try {
      const info = await readFile(file);
      renderPreview(info, mode);

      if (mode === "replace") {
        const ok = confirm(
          "Полностью заменить остатки?\n\n" +
          "Позиции, которых нет в этом файле, будут считаться отсутствующими на складе (остаток 0)."
        );
        if (!ok) return;
      }

      loading?.setText("Применяем изменения…");
      const result = await window.applyImportedCatalog?.(info.rows, mode, {
        filename: file.name,
        importedAt: new Date().toISOString()
      });

      if (!result?.ok) throw new Error(result?.error || "Импорт не применён");

      window.toast?.(
        "✅ Импорт завершён: +" + result.added +
        " новых, обновлено " + result.updated
      );
      input.value = "";
      document.querySelector("#importFileName").textContent = "Файл не выбран";
      renderPreview({rows:[]}, mode);
    } catch (e) {
      console.error("AMP Auto Excel import:", e);
      window.toast?.("❌ " + (e.message || "Ошибка импорта"));
    } finally {
      loading?.stop();
    }
  }

  function init() {
    const input = document.querySelector("#excelImportInput");
    const button = document.querySelector("#excelImportBtn");
    const publishButton = document.querySelector("#excelPublishBtn");
    const mode = document.querySelector("#excelImportMode");
    const fileName = document.querySelector("#importFileName");
    if (!input || !button) return;

    input.addEventListener("change", () => {
      fileName.textContent = input.files?.[0]?.name || "Файл не выбран";
    });

    button.addEventListener("click", importSelected);
    publishButton?.addEventListener("click", publishSelected);
    mode?.addEventListener("change", () => {
      if (input.files?.[0]) readFile(input.files[0]).then(info => renderPreview(info, mode.value)).catch(() => {});
    });
  }

  window.__ampExcelImport = { readFile, importSelected };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();