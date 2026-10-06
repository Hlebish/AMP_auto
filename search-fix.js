(() => {
  const partAliases = {
    капот: ["капот","hood","bonnet"],
    крыло: ["крыло","крылья","крило","wing"],
    бампер: ["бампер","бамперы","бампера","bumper"],
    дверь: ["дверь","двери","дверей","дверця","door"],
    фара: ["фара","фары","фар","headlight","headlamp"],
    фонарь: ["фонарь","фонари","ліхтар","tail light","taillight"],
    решетка: ["решетка","решётка","решітка","grille"],
    пластик: ["пластик","пластиковый","пластиковая","пластикове","plastic"],
    облицовка: ["облицовка","облицювання","накладка","trim"],
    зеркало: ["зеркало","дзеркало","mirror"],
    стекло: ["стекло","скло","glass"],
    подкрылок: ["подкрылок","підкрилок","fender liner"],
    усилитель: ["усилитель","підсилювач","reinforcement"],
    решітка: ["решітка","решетка","решётка","grille"]
  };

  const brandAliases = {
    bmw:["bmw","бмв"],
    audi:["audi","ауди","ауді"],
    mercedes:["mercedes","мерседес","mb"],
    volkswagen:["volkswagen","фольксваген","vw"],
    toyota:["toyota","тойота"],
    honda:["honda","хонда"],
    mazda:["mazda","мазда"],
    ford:["ford","форд"],
    nissan:["nissan","ниссан","ніссан"],
    renault:["renault","рено"],
    skoda:["skoda","шкода"],
    hyundai:["hyundai","хендай","хюндай"],
    kia:["kia","киа","кіа"],
    mitsubishi:["mitsubishi","митсубиси","мітсубісі"],
    opel:["opel","опель"],
    peugeot:["peugeot","пежо"],
    citroen:["citroen","ситроен","сітроен"],
    chevrolet:["chevrolet","шевроле","chevy"],
    lexus:["lexus","лексус"],
    subaru:["subaru","субару"],
    volvo:["volvo","вольво"],
    jaguar:["jaguar","ягуар"],
    jeep:["jeep","джип"]
  };

  const stopWords = new Set([
    "на","в","во","и","или","для","из","с","со","по","от","до",
    "к","у","о","об","про","the","a","an","of","for","with"
  ]);

  function clean(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g,"е")
      .replace(/[^a-zа-яіїєґ0-9]+/g," ")
      .trim();
  }

  function words(v) {
    return clean(v).split(/\s+/).filter(Boolean);
  }

  function stem(v) {
    let x = clean(v);
    x = x
      .replace(/(иями|ями|ами|ого|ему|ому|ими|ыми|ов|ев|ам|ям|ах|ях|ою|ею|ей|ий|ый|ая|яя|ое|ее|ые|ие|ов|ев|ом|ем|ой|ей|ам|ям|ы|и|а|я|у|ю|о|е)$/,"");
    return x.length >= 3 ? x : clean(v);
  }

  function variants(token) {
    const t = clean(token);
    const out = new Set([t, stem(t)]);

    for (const [key, arr] of Object.entries(partAliases)) {
      const all = [key, ...arr].map(clean);
      if (all.includes(t) || all.some(x => stem(x) === stem(t))) {
        all.forEach(x => {
          out.add(x);
          out.add(stem(x));
        });
      }
    }

    for (const [key, arr] of Object.entries(brandAliases)) {
      const all = [key, ...arr].map(clean);
      if (all.includes(t)) all.forEach(x => out.add(x));
    }

    return [...out].filter(Boolean);
  }

  function isBrandToken(token) {
    const t = clean(token);
    for (const [brand, arr] of Object.entries(brandAliases)) {
      if ([brand, ...arr].map(clean).includes(t)) return brand;
    }
    return null;
  }

  function isPartToken(token) {
    const t = clean(token);
    for (const [part, arr] of Object.entries(partAliases)) {
      if ([part, ...arr].map(clean).includes(t)) return part;
      if (arr.some(x => stem(x) === stem(t))) return part;
    }
    return null;
  }

  function fieldText(item) {
    return [
      item.catalog_number,
      item.manufacturer_parts,
      item.name,
      item.description,
      item.original_number,
      item.marks,
      item.models,
      item.engine,
      item.a,item.n,item.o,item.b,item.m,item.e,item.v
    ].filter(Boolean).join(" ");
  }

  function brandMatches(item, brand) {
    if (!brand) return true;

    const text = clean([
      item.catalog_number,
      item.name,
      item.description,
      item.marks,
      item.models
    ].filter(Boolean).join(" "));

    const ws = new Set(words(text));
    const names = [brand, ...(brandAliases[brand] || [])].map(clean);

    if (names.some(n => ws.has(n) || text.includes(" "+n+" "))) return true;

    // AP + two-letter brand code, e.g. APBM..., APAU..., APHD...
    const code = clean(item.catalog_number);
    const brandCodes = {
      bmw:["bm"], audi:["au"], mercedes:["mb"], volkswagen:["vw"],
      toyota:["ty"], honda:["hd"], mazda:["mz"], ford:["fd"],
      nissan:["ns"], renault:["rn","re"], skoda:["sk"], hyundai:["hy"],
      kia:["ki"], mitsubishi:["mt","mits"], opel:["op"], peugeot:["pg"],
      citroen:["ct"], chevrolet:["ch"], lexus:["lx"], subaru:["su"],
      volvo:["vo"], jaguar:["jg"], jeep:["jp"]
    };

    return (brandCodes[brand] || []).some(code2 =>
      new RegExp("^ap" + code2, "i").test(code)
    );
  }

  function partMatches(item, part) {
    if (!part) return false;

    const text = clean([
      item.name,
      item.description,
      item.manufacturer_parts,
      item.catalog_number
    ].filter(Boolean).join(" "));

    const variantsList = [part, ...(partAliases[part] || [])].map(clean);
    const textWords = words(text);
    const textStems = textWords.map(stem);

    return variantsList.some(v => {
      const sv = stem(v);
      return text.includes(v) ||
        textWords.some(w => w === v || w.startsWith(v) || w.startsWith(sv)) ||
        textStems.some(s => s === sv);
    });
  }

  function genericTokenMatches(item, token) {
    const text = clean(fieldText(item));
    const ws = words(text);
    const ss = ws.map(stem);

    return variants(token).some(v => {
      const sv = stem(v);
      return text.includes(v) ||
        ws.some(w => w === v || w.startsWith(v) || (sv.length >= 4 && w.startsWith(sv))) ||
        ss.some(s => s === sv);
    });
  }

  function articleSearch(q) {
    const compactQ = clean(q).replace(/\s+/g,"");
    if (!compactQ) return [];

    return catalog
      .map(item => {
        const fields = [
          item.catalog_number,item.manufacturer_parts,
          item.original_number,item.a,item.o
        ].filter(Boolean).map(x => clean(x).replace(/\s+/g,""));

        const exact = fields.some(x => x === compactQ);
        const contains = fields.some(x => x.includes(compactQ));

        return {
          item,
          score: exact ? 10000 : contains ? 9000 : 0
        };
      })
      .filter(x => x.score > 0)
      .sort((a,b) => b.score-a.score)
      .map(x => x.item);
  }

  window.searchParts = function(q) {
    const raw = String(q || "").trim();

    if (!raw) {
      render(catalog.slice(0,100), "Каталог склада");
      return;
    }

    const allTokens = words(raw);
    const tokens = allTokens.filter(t => !stopWords.has(t));

    if (!tokens.length) {
      render([], "Поиск: " + raw);
      return;
    }

    // Артикул / OEM — сначала точный поиск.
    if (tokens.length === 1 && /^(?=.*[a-z])(?=.*\d)[a-z0-9-]{4,}$/i.test(tokens[0])) {
      const exact = articleSearch(tokens[0]);
      if (exact.length) {
        render(exact, "Поиск: " + raw);
        return;
      }
    }

    const brands = tokens.map(isBrandToken).filter(Boolean);
    const parts = tokens.map(isPartToken).filter(Boolean);

    const scored = catalog.map(item => {
      let score = 0;

      // Марка должна совпасть, если она указана.
      if (brands.length) {
        if (!brands.some(b => brandMatches(item,b))) return null;
        score += 100;
        if (brands.some(b => clean(item.marks).includes(clean(b)))) score += 25;
      }

      // Тип детали должен совпасть, если указан.
      if (parts.length) {
        if (!parts.some(p => partMatches(item,p))) return null;
        score += 100;
        if (parts.some(p => partMatches(item,p))) score += 30;
      }

      // Остальные слова ищем мягче.
      for (const token of tokens) {
        if (brands.includes(isBrandToken(token)) || parts.includes(isPartToken(token))) continue;

        if (genericTokenMatches(item, token)) score += 15;
        else score -= 20;
      }

      // Бонусы за точность названия.
      const name = clean(item.name);
      const queryNoStop = tokens.join(" ");

      if (name.includes(queryNoStop)) score += 30;

      if (item.catalog_number && clean(item.catalog_number) === clean(raw)) {
        score += 500;
      }

      return { item, score };
    })
    .filter(Boolean)
    .filter(x => x.score > 0)
    .sort((a,b) => b.score-a.score);

    render(
      scored.map(x => x.item),
      "Поиск: " + raw
    );
  };

  // Кнопка уже вызывает searchParts динамически, поэтому
  // достаточно заменить глобальную функцию.
})();