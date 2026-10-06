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
    bmw:["bmw","бмв"], audi:["audi","ауди","ауді"],
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
    bmw:["bm"], audi:["au"], mercedes:["mb"], volkswagen:["vw"],
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

  function clean(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g,"е")
      .replace(/[^a-zа-яіїєґ0-9]+/g," ")
      .replace(/\s+/g," ")
      .trim();
  }

  function compact(v) {
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

  function brandMatches(item, brand) {
    const text = clean([
      item.catalog_number,item.name,item.description,item.marks,item.models
    ].filter(Boolean).join(" "));

    const ws = new Set(words(text));
    const names = [brand, ...(brandAliases[brand] || [])].map(clean);
    if (names.some(n => ws.has(n))) return true;

    const code = compact(item.catalog_number || "");
    return (brandCodes[brand] || []).some(c => code.startsWith("ap" + c));
  }

  // Ищем именно тип детали. Для "капот" наличие слова "капота" в "замок капота"
  // не должно делать замок главным результатом: такие составные детали получают штраф.
  function partScore(item, part) {
    const text = clean([
      item.name,item.description,item.manufacturer_parts,item.catalog_number
    ].filter(Boolean).join(" "));
    const ws = words(text);
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
    const text = clean(fieldText(item));
    const ws = words(text);
    const t = clean(token);
    const s = stem(t);
    if (ws.includes(t)) return 35;
    if (text.includes(t)) return 25;
    if (ws.some(w => w.startsWith(t) || (s.length >= 4 && w.startsWith(s)))) return 18;
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

  function searchableCatalog(partHint = null) {
    const stockRows = catalog.map(item => ({ item, source: "stock" }));
    const unavailableRows = Array.isArray(window.ampartsUnavailableCatalog)
      ? window.ampartsUnavailableCatalog
      : [];

    let orderRows = Array.isArray(window.orderCatalog)
      ? window.orderCatalog
      : [];

    if (partHint && window.orderPartIndex && Array.isArray(window.orderPartIndex[partHint])) {
      orderRows = window.orderPartIndex[partHint];
    }

    return [
      ...stockRows,
      ...unavailableRows.map(item => ({ item, source: "unavailable" })),
      ...orderRows.map(item => ({ item: asOrder(item), source: "order" }))
    ];
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
      return {
        item,
        source,
        score: exact ? 10000 : contains ? 9000 : 0
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
    const db = window.crossData || {};
    const byOem = db.by_oem || {};
    const byArticle = db.by_article || {};
    const key = compact(q);
    if (!key) return [];

    const direct = byOem[key] || [];
    const reverse = byArticle[key] || [];

    // Если ищем наш артикул — показываем его кроссы тоже.
    const combined = [...direct, ...reverse];
    const seen = new Set();

    return combined.filter(x => {
      const id = [x.article,x.brand,x.oem,x.oem_brand].join("|");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function crossOrderResults(q, stockItems) {
    const rows = crossRowsForQuery(q);
    if (!rows.length) return [];

    // Кроссы могут содержать наши AMParts-артикулы.
    // Они не должны становиться "ПОД ЗАКАЗ": если товара нет на складе,
    // показываем честный статус "НЕТ В НАЛИЧИИ".
    const result = [];
    const seen = new Set();
    const ownStockArticles = window.ownStockArticles || new Set();

    for (const row of rows) {
      const key = compact(row.article);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const ownByArticle = ownStockArticles.has(key);
      const ownByManufacturer =
        typeof window.isOwnManufacturer === "function"
          ? window.isOwnManufacturer(row.brand || "")
          : compact(row.brand || "") === "amparts";

      if (ownByArticle) {
        // Наш склад уже должен вывести эту деталь зелёной.
        continue;
      }

      if (ownByManufacturer) {
        result.push(
          typeof window.makeUnavailableOwnPart === "function"
            ? window.makeUnavailableOwnPart(row, q)
            : {
                _unavailable: true,
                _order: false,
                _amparts: true,
                catalog_number: row.article,
                manufacturer_parts: row.brand || "AMPARTS",
                original_number: row.oem || q,
                name: "Деталь " + row.article,
                quantity: 0,
                price: ""
              }
        );
        continue;
      }

      result.push({
        _order: true,
        _order_brand: row.brand || "",
        _order_oem: row.oem || q,
        catalog_number: row.article,
        manufacturer_parts: row.brand || "",
        original_number: row.oem || q,
        name: "Деталь " + row.article,
        marks: row.oem_brand ? row.oem_brand.toUpperCase() : "",
        quantity: "",
      });
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
    const indexedPart = parts.length === 1 && tokens.length === 1 ? parts[0] : null;
    const scored = searchableCatalog(indexedPart).map(({item, source}) => {
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

        if (primaryPart && partScore(item, primaryPart) >= 140) score += 160;
      }

      for (const token of tokens) {
        if (brandToken(token) || partToken(token)) continue;
        score += genericMatchScore(item, token);
      }

      const name = clean(item.name);
      const phrase = clean(tokens.join(" "));
      if (phrase && name.includes(phrase)) score += 120;

      if (parts.length === 1 && primaryPart) {
        const ps = partScore(item, primaryPart);
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