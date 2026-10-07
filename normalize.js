(() => {
  // Единая нормализация артикулов/OEM для всего AMP Auto.
  // Используется одинаково при индексации данных и при поиске пользователя.
  const CYR_TO_LAT = {
    "А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H",
    "О":"O","Р":"P","С":"C","Т":"T","Х":"X","У":"Y",
    "а":"A","в":"B","е":"E","к":"K","м":"M","н":"H",
    "о":"O","р":"P","с":"C","т":"T","х":"X","у":"Y"
  };

  function normalizePartNumber(value) {
    if (value == null) return "";
    let s = String(value).normalize("NFKC").trim();
    if (!s) return "";

    // Убираем типичные невидимые/неразрывные пробелы.
    s = s.replace(/[\u00A0\u2007\u202F\u200B\uFEFF]/g, "");

    // Смешанная русская/латинская раскладка.
    s = s.replace(/[АВЕКМНОРСТХУавекмнорстху]/g, ch => CYR_TO_LAT[ch] || ch);

    // Убираем пробелы, дефисы, точки, слэши и прочие разделители.
    return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function normalizePartNumberVariants(value) {
    const raw = String(value ?? "").trim();
    const key = normalizePartNumber(raw);
    return key ? [key] : [];
  }

  window.normalizePartNumber = normalizePartNumber;
  window.normalizePartNumberVariants = normalizePartNumberVariants;
})();