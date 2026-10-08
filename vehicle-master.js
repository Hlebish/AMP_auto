(() => {
  /*
   * AMP Auto — Vehicle Master
   * -------------------------
   * Автомобильная часть каталога отделена от товарной строки.
   *
   * ВАЖНО:
   * 1) В UI попадают только модели/поколения, для которых существует
   *    хотя бы одна товарная строка с автомобильным fitment.
   * 2) Мы не создаём автомобильные конфигурации "из воздуха".
   * 3) Годы/двигатели/объёмы/топливо/кузов берутся только из доказательств
   *    конкретных строк каталога.
   * 4) Слой подготовлен так, чтобы позже заменить источник facts на
   *    лицензированный TecDoc/другой authoritative vehicle dataset,
   *    не меняя UI и товарный поиск.
   */

  const master = {
    version: "20261008-v1",
    source: "catalog-fitment-evidence",
    profiles: [],
    byBrand: new Map(),
    byModel: new Map(),
    ready: false
  };

  const clean = value => String(value ?? "").trim();

  const keyNorm = value =>
    typeof norm === "function"
      ? norm(value)
      : clean(value).toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/g, " ").trim();

  const unique = values => {
    const seen = new Set();
    const out = [];
    for (const value of values) {
      const text = clean(value);
      const key = keyNorm(text);
      if (!text || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  };

  function canonicalModelName(value) {
    let text = clean(value);
    if (!text) return "";

    // Убираем годы, чтобы "Mazda CX-7 2007-2012" не создавала
    // отдельную модель вместо CX-7.
    text = text
      .replace(/\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2})?\b/g, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ");

    // Коды поколения оставляем отдельно.
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  function generationCodes(value) {
    if (typeof modelCodes === "function") {
      return unique(modelCodes(value));
    }
    const match = clean(value).match(/\(([^)]{1,80})\)/);
    if (!match) return [];
    return unique(match[1].split(/[,/;|]+/));
  }

  function modelFamilyName(value) {
    if (typeof modelFamily === "function") {
      return clean(modelFamily(value));
    }

    let text = canonicalModelName(value);
    text = text.replace(/\s*\([^)]*\)\s*/g, " ");
    return text.replace(/\s+/g, " ").trim();
  }

  function modelKey(brand, family, codes) {
    return [
      keyNorm(brand),
      keyNorm(family),
      unique(codes).sort().map(keyNorm).join("|")
    ].join("::");
  }

  // Строим доказательства связи БРЕНД -> МОДЕЛЬ только по строкам,
  // где указана ровно одна марка. Строка вида "MITSUBISHI,SMART" не
  // означает, что каждая модель из списка относится к обеим маркам.
  // Именно такое декартово сопоставление раньше порождало ложные ветки
  // вроде MAZDA -> Santa Fe.
  function buildBrandModelEvidence(rows) {
    const evidence = new Map();

    for (const row of rows || []) {
      const brands = typeof splitValues === "function"
        ? splitValues(row?.marks)
        : clean(row?.marks).split(/[,;|]+/);
      const normalizedBrands = unique(brands.map(keyNorm).filter(Boolean));
      if (normalizedBrands.length !== 1) continue;

      const brandKey = normalizedBrands[0];
      const models = typeof splitValues === "function"
        ? splitValues(row?.models)
        : clean(row?.models).split(/[,;|]+/);

      if (!evidence.has(brandKey)) evidence.set(brandKey, new Set());
      const set = evidence.get(brandKey);

      for (const rawModel of models) {
        const family = modelFamilyName(rawModel);
        if (!family) continue;
        const codes = generationCodes(rawModel);
        set.add(modelKey(brandKey, family, codes));
      }
    }

    return evidence;
  }

  function parseProfileFromRow(row, brandEvidence) {
    const brands = typeof splitValues === "function"
      ? splitValues(row?.marks)
      : clean(row?.marks).split(/[,;|]+/);

    const models = typeof splitValues === "function"
      ? splitValues(row?.models)
      : clean(row?.models).split(/[,;|]+/);

    const normalizedBrands = unique(brands.map(keyNorm).filter(Boolean));
    const result = [];

    for (const brandRaw of brands) {
      const brand = clean(brandRaw);
      const brandKey = keyNorm(brand);
      if (!brand || !brandKey) continue;

      // Однозначная строка: все модели принадлежат этой единственной марке.
      // Мультибрендовая строка: берём только те модели/поколения, которые
      // уже подтверждены отдельными однобрендовыми строками.
      const allowedModels = normalizedBrands.length === 1
        ? models
        : models.filter(modelRaw => {
            const family = modelFamilyName(modelRaw);
            const codes = generationCodes(modelRaw);
            const evidence = brandEvidence?.get(brandKey);
            if (!evidence || !family) return false;
            return evidence.has(modelKey(brandKey, family, codes));
          });

      for (const modelRaw of allowedModels) {
        const model = clean(modelRaw);
        if (!model) continue;

        const family = modelFamilyName(model);
        if (!family) continue;

        const codes = generationCodes(model);
        let years = typeof extractYears === "function"
          ? extractYears(row).flatMap(r => {
              const from = Number(r?.from);
              const to = Number(r?.to ?? r?.from);
              if (!Number.isFinite(from)) return [];
              if (!Number.isFinite(to)) return [from];
              const safeTo = Math.min(to, new Date().getFullYear());
              const values = [];
              for (let y = from; y <= safeTo; y++) {
                if (y >= 1950 && y <= new Date().getFullYear()) values.push(y);
              }
              return values;
            })
          : [];

        // Для Mazda CX-7 (ER) в части товарных строк год отсутствует.
        // Официальные материалы Mazda указывают выпуск CX-7 с конца 2006
        // до 2011 года; для aftermarket-подбора используем календарный
        // модельный диапазон 2006–2012, согласованный с текущими данными
        // каталога и существующим UI fallback.
        if (
          keyNorm(brand) === "mazda" &&
          keyNorm(family) === "cx 7" &&
          codes.some(code => keyNorm(code) === "er")
        ) {
          years = unique([...years, ...Array.from({length: 7}, (_, i) => 2006 + i)])
            .map(Number)
            .sort((a, b) => b - a);
        }

        const engines = typeof splitValues === "function"
          ? splitValues(row?.engine)
          : clean(row?.engine).split(",");

        const volumes = typeof engineVolumes === "function"
          ? engineVolumes(row)
          : [];

        const fuel = typeof fuelType === "function" ? fuelType(row) : "";
        const body = typeof bodyType === "function" ? bodyType(row) : "";

        result.push({
          brand,
          family,
          codes,
          key: modelKey(brand, family, codes),
          years: unique(years).map(Number).sort((a, b) => b - a),
          engines: unique(engines),
          volumes: unique(volumes).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
          fuels: fuel ? [fuel] : [],
          bodies: body ? [body] : [],
          evidenceCount: 1
        });
      }
    }

    return result;
  }

  function mergeProfiles(rows) {
    const map = new Map();
    const brandEvidence = buildBrandModelEvidence(rows);

    for (const row of rows || []) {
      for (const profile of parseProfileFromRow(row, brandEvidence)) {
        const existing = map.get(profile.key);

        if (!existing) {
          map.set(profile.key, {
            ...profile,
            years: [...profile.years],
            engines: [...profile.engines],
            volumes: [...profile.volumes],
            fuels: [...profile.fuels],
            bodies: [...profile.bodies]
          });
          continue;
        }

        existing.evidenceCount++;

        existing.years = unique([...existing.years, ...profile.years])
          .map(Number)
          .filter(Number.isFinite)
          .sort((a, b) => b - a);

        existing.engines = unique([...existing.engines, ...profile.engines]);

        existing.volumes = unique([...existing.volumes, ...profile.volumes])
          .map(Number)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);

        existing.fuels = unique([...existing.fuels, ...profile.fuels]);
        existing.bodies = unique([...existing.bodies, ...profile.bodies]);
      }
    }

    return [...map.values()];
  }

  function build(rows) {
    const profiles = mergeProfiles(rows);

    master.profiles = profiles;
    master.byBrand = new Map();
    master.byModel = new Map();

    for (const profile of profiles) {
      const brandKey = keyNorm(profile.brand);
      const modelKeyValue = keyNorm(profile.family);

      if (!master.byBrand.has(brandKey)) master.byBrand.set(brandKey, []);
      master.byBrand.get(brandKey).push(profile);

      if (!master.byModel.has(modelKeyValue)) master.byModel.set(modelKeyValue, []);
      master.byModel.get(modelKeyValue).push(profile);
    }

    master.ready = true;
    window.vehicleMaster = master;

    return master;
  }

  function getBrandProfiles(brand) {
    return master.byBrand.get(keyNorm(brand)) || [];
  }

  function getModelProfiles(brand, model) {
    const brandProfiles = getBrandProfiles(brand);
    const targetFamily = typeof modelFamily === "function"
      ? modelFamily(model)
      : modelFamilyName(model);

    return brandProfiles.filter(profile => {
      const familyEqual = keyNorm(profile.family) === keyNorm(targetFamily);
      if (!familyEqual) return false;

      const requestedCodes = generationCodes(model);
      if (!requestedCodes.length) return true;

      return requestedCodes.some(code => profile.codes.includes(code));
    });
  }

  function profileLabel(profile) {
    const codes = unique(profile.codes);
    return codes.length
      ? profile.family + " (" + codes.join(", ") + ")"
      : profile.family;
  }

  function profileHasFilter(profile, filters = {}) {
    if (filters.year) {
      const year = Number(filters.year);
      if (profile.years.length && !profile.years.includes(year)) return false;
    }

    if (filters.engine) {
      const target = keyNorm(filters.engine);
      if (
        profile.engines.length &&
        !profile.engines.some(engine =>
          keyNorm(engine) === target ||
          keyNorm(engine).includes(target) ||
          target.includes(keyNorm(engine))
        )
      ) return false;
    }

    if (filters.volume) {
      const volume = Number(String(filters.volume).replace(",", "."));
      if (
        Number.isFinite(volume) &&
        profile.volumes.length &&
        !profile.volumes.some(v => Math.abs(Number(v) - volume) < 0.06)
      ) return false;
    }

    if (filters.fuel && profile.fuels.length && !profile.fuels.includes(filters.fuel)) {
      return false;
    }

    if (filters.body && profile.bodies.length && !profile.bodies.includes(filters.body)) {
      return false;
    }

    return true;
  }

  function filteredProfiles(filters = {}) {
    return getModelProfiles(filters.brand, filters.model)
      .filter(profile => profileHasFilter(profile, filters));
  }

  function optionValues(profiles, field) {
    const values = [];

    for (const profile of profiles) {
      const source = profile[field] || [];
      for (const value of source) values.push(value);
    }

    return unique(values);
  }

  function setOptions(el, placeholder, values, formatter = value => value) {
    if (!el) return;

    const current = clean(el.value);

    el.innerHTML =
      '<option value="">' +
      escapeHtml(placeholder) +
      '</option>' +
      values.map(value =>
        '<option value="' +
        escapeHtml(String(value)) +
        '">' +
        escapeHtml(formatter(value)) +
        '</option>'
      ).join("");

    if ([...el.options].some(option => option.value === current)) {
      el.value = current;
    }
  }

  function populateBrandsStrict(preserve = true) {
    const el = $("#brand");
    if (!el) return;

    const current = preserve ? clean(el.value) : "";
    const brands = unique(
      [...master.byBrand.values()]
        .flat()
        .map(profile => profile.brand)
    ).sort((a, b) => a.localeCompare(b, "ru"));

    setOptions(el, "Марка", brands.map(v => v.toUpperCase()));

    if (current && [...el.options].some(o => keyNorm(o.value) === keyNorm(current))) {
      el.value = current;
    }
  }

  function populateModelsStrict(resetValue = true) {
    const brand = clean($("#brand")?.value);
    const el = $("#model");
    if (!el) return;

    const current = resetValue ? "" : clean(el.value);
    const profiles = getBrandProfiles(brand);

    const groups = new Map();

    for (const profile of profiles) {
      const label = profileLabel(profile);
      const key = profile.key;

      if (!groups.has(key)) {
        groups.set(key, {
          raw: label,
          label,
          family: profile.family,
          codes: profile.codes,
          key
        });
      }
    }

    const models = [...groups.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "ru")
    );

    el.innerHTML =
      '<option value="">Модель</option>' +
      models.map(model =>
        '<option value="' +
        escapeHtml(model.raw) +
        '">' +
        escapeHtml(model.label) +
        '</option>'
      ).join("");

    if (current) {
      const option = [...el.options].find(o => keyNorm(o.value) === keyNorm(current));
      el.value = option ? option.value : "";
    } else {
      el.value = "";
    }

    populateFiltersStrict(0);
  }

  function populateFiltersStrict(changedIndex = 0) {
    const brand = clean($("#brand")?.value);
    const model = clean($("#model")?.value);
    if (!brand || !model) {
      setOptions($("#year"), "Год — любой", []);
      setOptions($("#engine"), "Двигатель — любой", []);
      setOptions($("#volume"), "Объём — любой", []);
      setOptions($("#fuel"), "Топливо — любое", []);
      setOptions($("#body"), "Кузов — любой", []);
      return;
    }

    const selected = {
      year: clean($("#year")?.value),
      engine: clean($("#engine")?.value),
      volume: clean($("#volume")?.value),
      fuel: clean($("#fuel")?.value),
      body: clean($("#body")?.value)
    };

    const profiles = getModelProfiles(brand, model);

    // Каждый select показывает только значения, которые существуют
    // в реальных профилях автомобиля и не противоречат уже выбранным
    // параметрам. Значение "любой" не создаёт искусственную конфигурацию.
    const yearProfiles = profiles.filter(p =>
      profileHasFilter(p, {
        engine: selected.engine,
        volume: selected.volume,
        fuel: selected.fuel,
        body: selected.body
      })
    );

    const engineProfiles = profiles.filter(p =>
      profileHasFilter(p, {
        year: selected.year,
        volume: selected.volume,
        fuel: selected.fuel,
        body: selected.body
      })
    );

    const volumeProfiles = profiles.filter(p =>
      profileHasFilter(p, {
        year: selected.year,
        engine: selected.engine,
        fuel: selected.fuel,
        body: selected.body
      })
    );

    const fuelProfiles = profiles.filter(p =>
      profileHasFilter(p, {
        year: selected.year,
        engine: selected.engine,
        volume: selected.volume,
        body: selected.body
      })
    );

    const bodyProfiles = profiles.filter(p =>
      profileHasFilter(p, {
        year: selected.year,
        engine: selected.engine,
        volume: selected.volume,
        fuel: selected.fuel
      })
    );

    const years = optionValues(yearProfiles, "years")
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    const engines = optionValues(engineProfiles, "engines")
      .sort((a, b) => a.localeCompare(b, "ru"));

    const volumes = optionValues(volumeProfiles, "volumes")
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const fuels = optionValues(fuelProfiles, "fuels")
      .sort((a, b) => a.localeCompare(b, "ru"));

    const bodies = optionValues(bodyProfiles, "bodies")
      .sort((a, b) => a.localeCompare(b, "ru"));

    setOptions($("#year"), "Год — любой", years);
    setOptions($("#engine"), "Двигатель — любой", engines);
    setOptions($("#volume"), "Объём — любой", volumes, value =>
      Number(value).toLocaleString("ru-RU", {maximumFractionDigits: 2}) + " л"
    );
    setOptions($("#fuel"), "Топливо — любое", fuels);
    setOptions($("#body"), "Кузов — любой", bodies);

    // После перестройки ещё раз восстанавливаем только существующие значения.
    for (const [selector, value] of [
      ["#year", selected.year],
      ["#engine", selected.engine],
      ["#volume", selected.volume],
      ["#fuel", selected.fuel],
      ["#body", selected.body]
    ]) {
      const el = $(selector);
      if (!el || !value) continue;
      if ([...el.options].some(o => o.value === value)) el.value = value;
    }
  }

  let baseVehicleFitmentStatus = null;

  function strictVehicleFitmentStatus(item, filters = {}) {
    // Сначала обычная проверка строки товара.
    // Сохраняем исходную функцию до установки master-обёртки,
    // иначе обёртка вызвала бы сама себя.
    if (typeof baseVehicleFitmentStatus !== "function") return "possible";

    const baseStatus = baseVehicleFitmentStatus(item, filters);
    if (baseStatus === "no") return "no";

    // Проверяем, существует ли вообще выбранная конфигурация в master.
    // Если нет — не разрешаем поиску показывать "возможную" деталь.
    if (filters.brand && filters.model) {
      const profiles = filteredProfiles(filters);
      if (!profiles.length) return "no";
    }

    return baseStatus;
  }

  function install() {
    const originalPopulateBrands = window.populateBrands;
    baseVehicleFitmentStatus = window.vehicleFitmentStatus;
    const originalPopulateModels = window.populateModels;

    // Функции объявлены как глобальные function declarations в app.js,
    // поэтому заменяем глобальные ссылки до загрузки каталога.
    window.populateBrands = populateBrandsStrict;
    window.populateModels = populateModelsStrict;
    window.populateCarFilters = populateFiltersStrict;

    window.vehicleFitmentStatus = strictVehicleFitmentStatus;
    window.vehicleMaster = master;

    // Кнопка поиска должна использовать уже установленный master-layer.
    const carButton = $("#carBtn");
    if (carButton && typeof window.searchCar === "function") {
      carButton.onclick = window.searchCar;
    }

    // Если каталог уже загружен к моменту установки слоя — строим сразу.
    if (Array.isArray(window.currentCatalog) && window.currentCatalog.length) {
      build(window.currentCatalog);
      populateBrandsStrict(true);
    }

    // Если каталог загружается позже — installCatalog() вызовет наши
    // переопределённые populateBrands/populateModels, а этот hook
    // перестроит master после фактической установки данных.
    const rebuild = () => {
      if (Array.isArray(window.currentCatalog) && window.currentCatalog.length) {
        build(window.currentCatalog);
        populateBrandsStrict(true);

        const brand = clean($("#brand")?.value);
        if (brand) populateModelsStrict(false);
      }
    };

    window.addEventListener("amp:auto-catalog-installed", rebuild);
    window.__ampVehicleMasterRebuild = rebuild;

    // Дополнительный запасной hook для текущего loader.
    const originalInstallCatalog = window.installCatalog;
    if (typeof originalInstallCatalog === "function") {
      window.installCatalog = function(rows, silent) {
        const result = originalInstallCatalog(rows, silent);
        build(rows);
        populateBrandsStrict(true);
        return result;
      };
    }

    return {
      originalPopulateBrands,
      originalPopulateModels
    };
  }

  window.vehicleMaster = master;
  window.buildVehicleMaster = build;
  window.getVehicleProfiles = getModelProfiles;
  window.getVehicleProfilesForSelection = filteredProfiles;

  // app.js загружается перед нами, поэтому его функции уже доступны.
  install();

  // catalog-loader.js загружается после этого файла. Он установит
  // window.currentCatalog через installCatalog(). Здесь оставляем
  // лёгкий polling только на случай старого кэша/нестандартного порядка
  // загрузки — он прекращается сразу после построения master.
  let attempts = 0;
  const waitForCatalog = () => {
    if (Array.isArray(window.currentCatalog) && window.currentCatalog.length) {
      build(window.currentCatalog);
      populateBrandsStrict(true);
      return;
    }

    attempts++;
    if (attempts < 120) setTimeout(waitForCatalog, 100);
  };

  waitForCatalog();
})();
