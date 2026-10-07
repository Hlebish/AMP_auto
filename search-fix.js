(() => {
  // Улучшенный "человеческий" поиск AMP Auto.
  // Принцип: сначала точное совпадение типа детали, затем составные детали,
  // затем бренд/авто и только после этого мягкое текстовое совпадение.

  const partAliases = {
    капот: ["капот","капота","капоту","капотом","hood","bonnet"],
    крыло: ["крыло","крыла","крылу","крылом","крылья","крило","wing","fender"],
    бампер: ["бампер","бампера","бамперу","бампером","бамперы","bumper"],
    дверь: ["дверь","двери","дверей","дверью","дверця","door"],
    фара: ["фара","фары","фар","фару","фарами","headlight","headlamp"],
    фонарь: ["фонарь","фонари","фонаря","ліхтар","tail light","taillight"],
    решетка: ["решетка","решётка","решітка","решетки","решітки","grille"],
    пластик: ["пластик","пластика","пластиковый","пластиковая","пластикове","plastic"],
    облицовка: ["облицовка","облицовки","облицювання","trim"],
    накладка: ["накладка","накладки","накладку","накладок","накладна","накладні","trim"],
    зеркало: ["зеркало","зеркала","дзеркало","mirror"],
    стекло: ["стекло","стекла","скло","glass"],
    подкрылок: ["подкрылок","подкрылка","подкрылки","підкрилок","fender liner"],
    усилитель: ["усилитель","усилителя","підсилювач","reinforcement"],
    решетка_радиатора: ["решетка радиатора","решётка радиатора","решітка радіатора","radiator grille"],
    замок: ["замок","замка","замку","замок капота","замок двери","lock","latch"],
    ручка: ["ручка","ручки","ручку","handle"],
    молдинг: ["молдинг","молдинги","молдингa","molding"],
    спойлер: ["спойлер","спойлера","spoiler"],
    крышка: ["крышка","крышки","крышку","кришка","cover"],
    защита: ["защита","защиты","защиту","захист","guard"],
    подкрыльник: ["подкрыльник","підкрилок","fender liner"],
    поршень: ["поршень","поршни","поршня","поршней","поршнями","поршень двигателя","piston","pistons"],
    колодка: ["колодка","колодки","тормозная колодка","brake pad"],
    диск: ["диск","диски","тормозной диск","brake disc"],
    фильтр: ["фильтр","фильтры","filter"],
    свеча: ["свеча","свечи","свеча зажигания","spark plug"]
  };

  const brandAliases = {
    bmw:["bmw","бмв"], mini:["mini","мини"], audi:["audi","ауди","ауді"],
    mercedes:["mercedes","мерседес","mb","мерс"],
    volkswagen:["volkswagen","фольксваген","vw"],
    toyota:["toyota","тойота"], honda:["honda","хонда"],
    mazda:["mazda","мазда"], ford:["ford","форд"],
    nissan:["nissan","ниссан","ніссан"], renault:["renault","рено"],
    skoda:["skoda","шкода"], hyundai:["hyundai","хендай","хюндай"],
    kia:["kia","киа","кіа"], mitsubishi:["mitsubishi","митсубиси","мітсубісі"],
    opel:["opel","опель"], peugeot:["peugeot","пежо"],
    citroen:["citroen","ситроен","сітроен"], chevrolet:["chevrolet","шевроле","chevy"],
    lexus:["lexus","лексус"], subaru:["subaru","субару"],
    volvo:["volvo","вольво"], jaguar:["jaguar","ягуар"], jeep:["jeep","джип"]
  };

  const brandCodes = {
    bmw:["bm"], mini:["mn"], audi:["au"], mercedes:["mb"], volkswagen:["vw"],
    toyota:["ty"], honda:["hd"], mazda:["mz"], ford:["fd"],
    nissan:["ns"], renault:["rn","re"], skoda:["sk"], hyundai:["hy"],
    kia:["ki"], mitsubishi:["mt","mits"], opel:["op"], peugeot:["pg"],
    citroen:["ct"], chevrolet:["ch"], lexus:["lx"], subaru:["su"],
    volvo:["vo"], jaguar:["jg"], jeep:["jp"]
  };

  const stopWords = new Set([
    "на","в","во","и","или","для","из","с","со","по","от","до","к","у","о","об","про",
    "на", "под", "над", "сзади", "спереди", "передний", "передняя", "переднее",
    "задний", "задняя", "заднее", "левый", "левая", "левое", "правый", "правая",
    "правое", "the","a","an","of","for","with","on"
  ]);

  // Кэшируем дорогую нормализацию текста между запросами.
  const searchTextCache = new WeakMap();

  function clean(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g,"е")
      .replace(/[^a-zа-яіїєґ0-9]+/g," ")
      .replace(/\s+/g," ")
      .trim();
  }

  function compact(v) {
    if (typeof window.normalizePartNumber === "function") return window.normalizePartNumber(v);
    return clean(v).replace(/\s+/g,"");
  }

  function words(v) {
    return clean(v).split(/\s+/).filter(Boolean);
  }

  function stem(v) {
    let x = clean(v);
    x = x.replace(/(иями|ями|ами|ого|ему|ому|ими|ыми|ов|ев|ам|ям|ах|ях|ою|ею|ей|ий|ый|ая|яя|ое|ее|ые|ие|ом|ем|ой|ы|и|а|я|у|ю|о|е)$/,"");
    return x.length >= 3 ? x : clean(v);
  }

  function aliasGroup(token, groups) {
    const t = clean(token);
    for (const [key, arr] of Object.entries(groups)) {
      const all = [key, ...arr].map(clean);
      if (all.includes(t) || all.some(x => stem(x) === stem(t))) return key;
    }
    return null;
  }

  function brandToken(t) { return aliasGroup(t, brandAliases); }
  function partToken(t) { return aliasGroup(t, partAliases); }

  function fieldText(item) {
    return [
      item.catalog_number,item.manufacturer_parts,item.name,item.description,
      item.original_number,item.marks,item.models,item.engine,
      item.a,item.n,item.o,item.b,item.m,item.e,item.v
    ].filter(Boolean).join(" ");
  }

  function cachedSearchData(item) {
    if (!item || typeof item !== "object") return { text:"", words:[] };
    let data = searchTextCache.get(item);
    if (data) return data;
    const text = clean(fieldText(item));
    data = { text, words: words(text) };
    searchTextCache.set(item, data);
    return data;
  }

  function brandMatches(item, brand) {
    const data = cachedSearchData(item);
    const text = data.text;
    const ws = new Set(data.words);
    const names = [brand, ...(brandAliases[brand] || [])].map(clean);
    if (names.some(n => ws.has(n))) return true;

    const code = compact(item.catalog_number || "");
    return (brandCodes[brand] || []).some(c => code.startsWith("ap" + c));
  }

  // Ищем именно тип детали. Для "капот" наличие слова "капота" в "замок капота"
  // не должно делать замок главным результатом: такие составные детали получают штраф.
  function partScore(item, part) {
    const data = cachedSearchData(item);
    const text = data.text;
    const ws = data.words;
    const aliases = [part, ...(partAliases[part] || [])].map(clean);
    let score = 0;

    for (const v of aliases) {
      const exactWord = ws.includes(v);
      const phrase = text.includes(v);
      if (exactWord) score = Math.max(score, 140);
      else if (phrase) score = Math.max(score, 100);
      else if (ws.some(w => w.startsWith(v) || w.startsWith(stem(v)))) score = Math.max(score, 70);
    }

    // Точная самостоятельная деталь сильнее, чем "замок капота", "накладка капота" и т.п.
    if (part === "капот") {
      if (/\b(замок|накладка|накладки|решетка|решетки|решітка|усилитель|молдинг|ручка|крышка)\s+капот\w*/u.test(text)) {
        score -= 80;
      }
    }
    if (part === "бампер") {
      if (/\b(накладка|решетка|решітка|усилитель|усилителя|молдинг)\s+бампер\w*/u.test(text)) {
        score -= 70;
      }
    }
    if (part === "дверь") {
      if (/\b(замок|ручка|накладка|молдинг)\s+двер\w*/u.test(text)) {
        score -= 70;
      }
    }

    return score;
  }

  function genericMatchScore(item, token) {
    const data = cachedSearchData(item);
    const text = data.text;
    const ws = data.words;
    const t = clean(token);
    const s = stem(t);
    if (ws.includes(t)) return 35;
    if (text.includes(t)) return 25;
    if (ws.some(w => w.startsWith(t) || (s.length >= 4 && w.startsWith(s)))) return 18;

    // Нечёткое совпадение включается только для достаточно длинных слов,
    // чтобы не превращать короткие запросы в случайные совпадения.
    if (t.length >= 5) {
      const maxDistance = t.length >= 8 ? 2 : 1;
      if (ws.some(w =>
        Math.abs(w.length - t.length) <= maxDistance &&
        levenshteinWithin(t, w, maxDistance) <= maxDistance
      )) return maxDistance === 1 ? 10 : 8;
    }

    return 0;
  }

  function asOrder(item) {
    if (item._order) return item;
    return {
      ...item,
      _order: true,
      _order_brand: item.manufacturer_parts || "",
      _order_oem: item.original_number || ""
    };
  }

  function searchableCatalog(partHint = null, brandHint = null) {
    const stockRows = catalog.map(item => ({ item, source: "stock" }));
    const unavailableRows = Array.isArray(window.ampartsUnavailableCatalog)
      ? window.ampartsUnavailableCatalog
      : [];

    let orderRows = Array.isArray(window.orderCatalog)
      ? window.orderCatalog
      : [];

    if (partHint && window.orderPartIndex && Array.isArray(window.orderPartIndex[partHint])) {
      orderRows = window.orderPartIndex[partHint];
    } else if (brandHint && window.orderBrandIndex && Array.isArray(window.orderBrandIndex[brandHint])) {
      orderRows = window.orderBrandIndex[brandHint];
    }

    return [
      ...stockRows,
      ...unavailableRows.map(item => ({ item, source: "unavailable" })),
      ...orderRows.map(item => ({ item: asOrder(item), source: "order" }))
    ];
  }

  function levenshteinWithin(a, b, maxDistance = 2) {
    a = compact(a);
    b = compact(b);
    if (!a || !b) return maxDistance + 1;
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
    if (a === b) return 0;

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;

      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const value = Math.min(
          cur[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
        cur[j] = value;
        if (value < rowMin) rowMin = value;
      }

      if (rowMin > maxDistance) return maxDistance + 1;
      prev = cur;
    }

    return prev[b.length];
  }

  function fuzzyCodeScore(query, value) {
    const a = compact(query);
    const b = compact(value);
    if (!a || !b || Math.abs(a.length - b.length) > 2) return 0;
    const distance = levenshteinWithin(a, b, a.length >= 8 ? 2 : 1);
    if (distance > (a.length >= 8 ? 2 : 1)) return 0;
    return distance === 0 ? 10000 : distance === 1 ? 7000 : 5000;
  }

  function articleSearch(q) {
    const cq = compact(q);
    if (!cq) return [];

    return searchableCatalog().map(({item, source}) => {
      const fields = [
        item.catalog_number,item.manufacturer_parts,item.original_number,item.a,item.o
      ].filter(Boolean).map(compact);

      const exact = fields.some(x => x === cq);
      const contains = fields.some(x => x.includes(cq));
      const fuzzy = !exact && !contains
        ? Math.max(...fields.map(x => fuzzyCodeScore(cq, x)), 0)
        : 0;

      return {
        item,
        source,
        score: exact ? 10000 : contains ? 9000 : fuzzy
      };
    })
    .filter(x => x.score > 0)
    .sort((a,b) => {
      if (b.score !== a.score) return b.score - a.score;
      const rank = { stock: 0, unavailable: 1, order: 2 };
      return (rank[a.source] ?? 3) - (rank[b.source] ?? 3);
    })
    .map(x => x.item);
  }

  function crossRowsForQuery(q) {
    if (typeof window.crossFamilyRows === "function") {
      return window.crossFamilyRows(q);
    }

    const db = window.crossData || {};
    const byOem = db.by_oem || {};
    const byArticle = db.by_article || {};
    const key = compact(q);
    if (!key) return [];

    return [...(byOem[key] || []), ...(byArticle[key] || [])];
  }

  function crossOrderResults(q, stockItems) {
    const rows = crossRowsForQuery(q);
    if (!rows.length) return [];

    const result = [];
    const seen = new Set();
    const ownStockArticles = window.ownStockArticles || new Set();

    const ownRows = rows.filter(row =>
      typeof window.isOwnManufacturer === "function"
        ? window.isOwnManufacturer(row.brand || "")
        : compact(row.brand || "") === "amparts"
    );

    const ownRow = ownRows.find(row =>
      ownStockArticles.has(compact(row.article || ""))
    ) || ownRows[0] || null;

    const ownArticle = compact(ownRow?.article || "");
    const orderRows = rows.filter(row =>
      !(typeof window.isOwnManufacturer === "function"
        ? window.isOwnManufacturer(row.brand || "")
        : compact(row.brand || "") === "amparts")
    );
    const firstOrderRow = orderRows[0] || null;

    // Сначала показываем нашу позицию как "НЕТ В НАЛИЧИИ",
    // если она существует как AMParts, но на складе её нет.
    if (ownRow && ownArticle && !ownStockArticles.has(ownArticle)) {
      const ownUnavailableMap = new Map(
        (window.ampartsUnavailableCatalog || [])
          .map(item => [compact(item.catalog_number), item])
      );

      const existing = ownUnavailableMap.get(ownArticle);
      const item = existing
        ? {
            ...existing,
            _unavailable: true,
            _order: false,
            _amparts: true
          }
        : (
            typeof window.makeUnavailableOwnPart === "function"
              ? window.makeUnavailableOwnPart(ownRow, q)
              : {
                  _unavailable: true,
                  _order: false,
                  _amparts: true,
                  catalog_number: ownRow.article,
                  manufacturer_parts: ownRow.brand || "AMPARTS",
                  original_number: ownRow.oem || q,
                  name: ownRow.article,
                  quantity: 0,
                  price: ""
                }
          );

      if (firstOrderRow) {
        item._order_offer_article = firstOrderRow.article || "";
        item._order_offer_brand = firstOrderRow.brand || "";
      }

      result.push(item);
      seen.add(ownArticle);
    }

    // Затем показываем реальные внешние варианты, которые можно заказать.
    for (const row of rows) {
      const key = compact(row.article);
      if (!key || seen.has(key)) continue;

      const ownByManufacturer =
        typeof window.isOwnManufacturer === "function"
          ? window.isOwnManufacturer(row.brand || "")
          : compact(row.brand || "") === "amparts";

      if (ownByManufacturer) continue;

      result.push({
        _order: true,
        _order_brand: row.brand || "",
        _order_oem: row.oem || q,
        _order_for_article: ownArticle || "",
        catalog_number: row.article,
        manufacturer_parts: row.brand || "",
        original_number: row.oem || q,
        name: row.article,
        marks: row.oem_brand ? row.oem_brand.toUpperCase() : "",
        quantity: "",
      });

      seen.add(key);
    }

    return result;
  }

  function mergeStockAndOrder(items, q) {
    // items уже содержит найденные позиции из обоих каталогов.
    // Никакой дедупликации по артикулу здесь нет:
    // один и тот же артикул на складе и под заказ должен показываться дважды.
    const catalogResults = items.map(item => {
      if (item._unavailable) return item;
      return qtyValue(item.quantity) > 0 ? item : asOrder(item);
    });

    const orders = crossOrderResults(q, catalogResults);

    // Не дублируем только дополнительный кросс, если такой артикул уже
    // пришёл из складского или заказного каталога.
    const seen = new Set(
      catalogResults
        .map(item => compact(item.catalog_number))
        .filter(Boolean)
    );

    const extraOrders = orders.filter(item => {
      const key = compact(item.catalog_number);
      if (!key || seen.has(key)) return false;

      // "НЕТ В НАЛИЧИИ" — отдельный собственный товар, не заказ.
      if (item._unavailable) {
        seen.add(key);
        return true;
      }

      seen.add(key);
      return true;
    });

    catalogResults.sort((a, b) => {
      const sa = a._order ? 0 : 1;
      const sb = b._order ? 0 : 1;
      return sb - sa;
    });

    return [...catalogResults, ...extraOrders];
  }

  function lazyOrderRefresh(raw) {
    if (!window.ensureOrderCatalog) return;
    if (Array.isArray(window.orderCatalog) && window.orderCatalog.length) return;
    if (window.__orderSearchLoading) return;

    window.__orderSearchLoading = true;
    window.ensureOrderCatalog()
      .then(ok => {
        window.__orderSearchLoading = false;
        if (ok && window.__lastSearchQuery === raw) {
          window.searchParts(raw);
        }
      })
      .catch(() => {
        window.__orderSearchLoading = false;
      });
  }


  window.searchParts = async function(q) {
    const raw = String(q || "").trim();
    window.__lastSearchQuery = raw;

    if (!raw) {
      render(catalog.slice(0,100), "Каталог склада");
      return;
    }

    // Кроссы нужны для поиска, но огромный прайс под заказ НЕ ждём.
    // Сначала мгновенно показываем склад, затем догружаем заказы в фоне.
    try {
      if (window.crossReady) await window.crossReady;
    } catch (e) {}

    const allTokens = words(raw);
    const tokens = allTokens.filter(t => !stopWords.has(t));

    // Артикул/OEM: сначала точные товары на складе, затем товары под заказ.
    if (tokens.length === 1 && /^(?=.*[a-z])(?=.*\d)[a-z0-9-]{4,}$/i.test(tokens[0])) {
      const exact = articleSearch(tokens[0]);
      const combined = mergeStockAndOrder(exact, tokens[0]);

      if (combined.length) {
        render(combined, "Поиск: " + raw);
        lazyOrderRefresh(raw);
        return;
      }
    }

    const brands = tokens.map(brandToken).filter(Boolean);
    const parts = tokens.map(partToken).filter(Boolean);

    const primaryPart = parts.length
      ? (tokens.map(partToken).find(Boolean) || parts[0])
      : null;

    // Если запрос состоит из одного типа детали, используем индекс заказного
    // каталога вместо полного прохода по сотням тысяч строк.
    const indexedPart = parts.length ? primaryPart : null;
    const indexedBrand = !indexedPart && brands.length === 1 ? brands[0] : null;
    const scored = searchableCatalog(indexedPart, indexedBrand).map(({item, source}) => {
      let score = 0;

      if (brands.length) {
        if (!brands.every(b => brandMatches(item,b))) return null;
        score += 220;
      }

      if (parts.length) {
        const partScores = parts.map(p => partScore(item,p));
        if (partScores.some(s => s <= 0)) return null;

        score += partScores.reduce((a,b) => a+b, 0);
        score += Math.max(...partScores);

        if (primaryPart && partScores[parts.indexOf(primaryPart)] >= 140) score += 160;
      }

      for (const token of tokens) {
        if (brandToken(token) || partToken(token)) continue;
        score += genericMatchScore(item, token);
      }

      const name = clean(item.name);
      const phrase = clean(tokens.join(" "));
      if (phrase && name.includes(phrase)) score += 120;

      if (parts.length === 1 && primaryPart) {
        const ps = partScores[parts.indexOf(primaryPart)] ?? 0;
        if (ps >= 140) score += 100;
      }

      if (item.catalog_number && compact(item.catalog_number) === compact(raw)) score += 5000;

      return { item, source, score };
    })
    .filter(Boolean)
    .filter(x => x.score > 0)
    .sort((a,b) => {
      if (b.score !== a.score) return b.score - a.score;
      const rank = { stock: 0, unavailable: 1, order: 2 };
      return (rank[a.source] ?? 3) - (rank[b.source] ?? 3);
    });

    const stock = scored.map(x => x.item);
    const combined = mergeStockAndOrder(stock, raw);

    render(combined, "Поиск: " + raw);
    lazyOrderRefresh(raw);
  };
})();