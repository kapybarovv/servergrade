(function adminClient() {
  const authenticated = document.body.dataset.authenticated === "true";
  const feedback = document.querySelector("[data-feedback]");
  const state = { banners: [], results: [], pins: new Set() };

  function showFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle("error", error);
    feedback.setAttribute("role", error ? "alert" : "status");
    feedback.hidden = !message;
  }

  async function api(path, data) {
    const response = await fetch(path, {
      method: data === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: data === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "Не удалось выполнить действие. Попробуйте ещё раз.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function action(button, callback) {
    button.disabled = true;
    showFeedback("");
    try {
      await callback();
    } catch (error) {
      showFeedback(error.message || "Ошибка соединения. Проверьте подключение и попробуйте ещё раз.", true);
      if (authenticated && error.status === 401) {
        window.setTimeout(() => window.location.reload(), 1400);
      }
    } finally {
      button.disabled = false;
    }
  }

  const loginForm = document.querySelector("[data-login]");
  if (!authenticated) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      action(loginForm.querySelector("button"), async () => {
        showFeedback("Проверяем пароль…");
        await api("/api/admin/login", { password: loginForm.elements.password.value });
        loginForm.elements.password.value = "";
        window.location.reload();
      });
    });
    return;
  }

  const form = document.querySelector("[data-banner-form]");
  const list = document.querySelector("[data-banner-list]");
  const resultBody = document.querySelector("[data-results-body]");
  const resultSearch = document.querySelector("[data-result-search]");
  const cancelEdit = document.querySelector("[data-cancel-edit]");
  const saveLabel = form.querySelector("[data-save-label]");
  const preview = document.querySelector("[data-image-preview]");
  const imageFile = form.elements.image_file;
  let imageData = "";
  let currentImage = "";
  let currentMime = "";
  let imageReadVersion = 0;
  let loadVersion = 0;
  let searchTimer;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function safeHttps(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function safeImage(value) {
    if (/^\/banners\/\d+(?:\?v=[a-f0-9]{64})?$/.test(value)) return value;
    if (/^\/api\/admin\/banners\/\d+\/image$/.test(value)) return value;
    if (/^data:(?:image\/(png|jpeg|webp)|video\/mp4);base64,[a-z0-9+/=]+$/i.test(value)) return value;
    return safeHttps(value);
  }

  function isVideo(value, mime = "") {
    return mime === "video/mp4" || /^data:video\/mp4;/i.test(value) || /\.mp4(?:[?#]|$)/i.test(value);
  }

  function showPreview(value, mime = "") {
    const url = safeImage(value);
    preview.hidden = !url;
    const image = preview.querySelector("img");
    const video = preview.querySelector("video");
    const movie = isVideo(url, mime);
    image.hidden = movie;
    video.hidden = !movie;
    if (url && !movie) image.src = url;
    else image.removeAttribute("src");
    if (url && movie) {
      video.muted = true;
      video.src = url;
      video.play?.()?.catch(() => {});
    } else {
      video.pause?.();
      video.removeAttribute("src");
      video.load?.();
    }
    preview.querySelector("[data-image-label]").textContent = imageData
      ? (movie ? "Видео готово к загрузке на сайт" : "Изображение готово к загрузке на сайт")
      : (movie ? "Текущее видео баннера" : "Текущее изображение баннера");
    preview.querySelector("[data-clear-image]").hidden = !imageData;
  }

  function svg(name) {
    const paths = {
      edit: '<path d="m16 3 5 5M4 20l4-1 13-13a2.1 2.1 0 0 0-3-3L5 16z"/>',
      trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
      pin: '<path d="m16 3 5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4zM2 22l6-6"/>',
    };
    const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    element.setAttribute("viewBox", "0 0 24 24");
    element.setAttribute("fill", "none");
    element.setAttribute("stroke", "currentColor");
    element.setAttribute("stroke-width", "1.8");
    element.setAttribute("stroke-linecap", "round");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("aria-hidden", "true");
    element.classList.add("icon");
    element.innerHTML = paths[name];
    return element;
  }

  function resetForm() {
    form.reset();
    form.elements.banner_id.value = "";
    form.elements.enabled.checked = true;
    form.elements.sort_order.value = "0";
    saveLabel.textContent = "Добавить баннер";
    cancelEdit.hidden = true;
    imageData = "";
    currentImage = "";
    currentMime = "";
    imageReadVersion++;
    form.querySelector("[type=submit]").disabled = false;
    showPreview("");
  }

  function editBanner(banner) {
    form.elements.banner_id.value = banner.id;
    form.elements.title.value = banner.title || "";
    form.elements.image_url.value = banner.image_mime ? "" : banner.image_url || "";
    imageFile.value = "";
    imageData = "";
    imageReadVersion++;
    form.querySelector("[type=submit]").disabled = false;
    currentImage = banner.image_url || "";
    currentMime = banner.image_mime || "";
    showPreview(currentImage, currentMime);
    form.elements.target_url.value = banner.target_url || "";
    form.elements.enabled.checked = Boolean(Number(banner.enabled));
    form.elements.sort_order.value = banner.sort_order || 0;
    saveLabel.textContent = "Сохранить изменения";
    cancelEdit.hidden = false;
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    form.elements.title.focus({ preventScroll: true });
  }

  function renderBanners() {
    list.replaceChildren();
    const activeCount = state.banners.filter((banner) => Number(banner.enabled) === 1).length;
    document.querySelector("[data-banner-count]").textContent = "Активных " + activeCount;
    if (!state.banners.length) {
      list.append(node("div", "empty", "Баннеров пока нет. Добавьте первый выше."));
      return;
    }
    const banners = [...state.banners].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    for (const banner of banners) {
      const card = node("article", "banner-card");
      const imageUrl = safeImage(banner.image_url);
      const movie = isVideo(imageUrl, banner.image_mime);
      const image = node(movie ? "video" : "img", "banner-image");
      if (movie) {
        image.muted = true;
        image.autoplay = true;
        image.loop = true;
        image.playsInline = true;
        image.preload = "metadata";
        image.setAttribute("playsinline", "");
        image.setAttribute("aria-label", banner.title || "Видеобаннер");
      } else {
        image.alt = banner.title || "Баннер";
        image.loading = "lazy";
      }
      if (imageUrl) image.src = imageUrl;
      image.referrerPolicy = "no-referrer";
      const info = node("div", "banner-info");
      info.append(node("div", "banner-title", banner.title || "Без названия"));
      info.append(node("div", "banner-link", banner.target_url || "Без ссылки"));
      const meta = node("div", "banner-meta");
      const enabled = Number(banner.enabled) === 1;
      meta.append(node("span", "badge" + (enabled ? " enabled" : ""), enabled ? "Активен" : "Скрыт"));
      meta.append(node("span", "", movie ? "Видео" : "Изображение"));
      meta.append(node("span", "", "Порядок " + (Number(banner.sort_order) || 0)));
      info.append(meta);
      const controls = node("div", "banner-actions");
      const toggle = node("button", "button secondary small", enabled ? "Скрыть" : "Показать");
      toggle.type = "button";
      toggle.addEventListener("click", () => action(toggle, async () => {
        await api("/api/admin/banners", { id: banner.id, action: "update", title: banner.title, target_url: banner.target_url, enabled: !enabled, sort_order: banner.sort_order });
        await loadData();
        showFeedback(enabled ? "Баннер скрыт." : "Баннер опубликован.");
      }));
      const edit = node("button", "icon-button");
      edit.type = "button";
      edit.title = "Редактировать баннер";
      edit.setAttribute("aria-label", "Редактировать «" + (banner.title || "Баннер") + "»");
      edit.append(svg("edit"));
      edit.addEventListener("click", () => editBanner(banner));
      const remove = node("button", "icon-button danger");
      remove.type = "button";
      remove.title = "Удалить баннер";
      remove.setAttribute("aria-label", "Удалить «" + (banner.title || "Баннер") + "»");
      remove.append(svg("trash"));
      remove.addEventListener("click", () => {
        if (!window.confirm("Удалить баннер «" + (banner.title || "Без названия") + "»?")) return;
        action(remove, async () => {
          await api("/api/admin/banners", { action: "delete", id: banner.id });
          if (form.elements.banner_id.value === String(banner.id)) resetForm();
          await loadData();
          showFeedback("Баннер удалён.");
        });
      });
      controls.append(toggle, edit, remove);
      card.append(image, info, controls);
      list.append(card);
    }
  }

  function displayDate(value) {
    const date = new Date(String(value || "").replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(value || "") ? "" : "Z"));
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(date);
  }

  function renderResults() {
    resultBody.replaceChildren();
    const query = resultSearch.value.trim().toLocaleLowerCase();
    const results = state.results.filter((result) => [result.id, result.country, result.city, result.cpu].join(" ").toLocaleLowerCase().includes(query));
    document.querySelector("[data-pin-count]").textContent = "Закреплено " + state.pins.size;
    document.querySelector("[data-results-count]").textContent = "Показано " + results.length + " из " + state.results.length;
    if (!results.length) {
      const cell = node("td", "empty", query ? "По вашему запросу замеры не найдены." : "Опубликованных замеров пока нет.");
      cell.colSpan = 5;
      const row = node("tr");
      row.append(cell);
      resultBody.append(row);
      return;
    }
    for (const result of results) {
      const id = String(result.id);
      const pinned = state.pins.has(id);
      const row = node("tr");
      const idCell = node("td");
      const link = node("a", "test-id", "#" + id);
      link.href = "/test/" + encodeURIComponent(id);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      idCell.append(link);
      const server = node("td", "server");
      server.append(node("div", "server-name", [result.country, result.city].filter(Boolean).join(" · ") || "Локация не указана"));
      server.append(node("div", "cpu", result.cpu || "CPU не указан"));
      const rating = node("td", "rating rating-col", String(Math.max(0, Math.min(100, Number(result.score) || 0))));
      const date = node("td", "date date-col", displayDate(result.created_at));
      const pinCell = node("td", "pin-cell");
      const pin = node("button", "button secondary small pin-button");
      pin.type = "button";
      pin.setAttribute("aria-pressed", String(pinned));
      pin.setAttribute("aria-label", (pinned ? "Открепить" : "Закрепить") + " тест " + id);
      pin.title = pinned ? "Открепить тест" : "Закрепить тест";
      pin.append(svg("pin"), node("span", "", pinned ? "Закреплён" : "Закрепить"));
      pin.addEventListener("click", () => action(pin, async () => {
        await api("/api/admin/pins", { result_id: id, pinned: !pinned });
        await loadData();
        showFeedback("Тест #" + id + (pinned ? " откреплён." : " закреплён."));
      }));
      pinCell.append(pin);
      row.append(idCell, server, rating, date, pinCell);
      resultBody.append(row);
    }
  }

  async function loadData() {
    const version = ++loadVersion;
    const query = resultSearch.value.trim();
    let data;
    try {
      data = await api("/api/admin/state" + (query ? "?search=" + encodeURIComponent(query) : ""));
    } catch (error) {
      if (version !== loadVersion) return;
      throw error;
    }
    if (version !== loadVersion) return;
    state.banners = data.banners || [];
    state.results = data.results || [];
    state.pins = new Set((data.pins || []).map((pin) => String(pin.result_id)));
    for (const result of state.results) {
      if (Number(result.pinned) === 1) state.pins.add(String(result.id));
    }
    renderBanners();
    renderResults();
    document.querySelector("[data-loading]").hidden = true;
    document.querySelector("[data-admin-content]").hidden = false;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = form.elements;
    const imageUrl = safeHttps(fields.image_url.value.trim());
    const targetUrl = safeHttps(fields.target_url.value.trim());
    const editing = Boolean(fields.banner_id.value);
    if (!targetUrl || (fields.image_url.value.trim() && !imageUrl)) {
      showFeedback("Укажите полные HTTPS-ссылки на баннер и страницу перехода.", true);
      return;
    }
    if (!editing && !imageData && !imageUrl) {
      showFeedback("Выберите изображение или MP4 либо укажите HTTPS-ссылку на баннер.", true);
      return;
    }
    const data = {
      action: editing ? "update" : "create",
      title: fields.title.value.trim(),
      target_url: targetUrl,
      enabled: fields.enabled.checked,
      sort_order: Number(fields.sort_order.value),
    };
    if (imageData) data.image_data = imageData;
    else if (imageUrl) data.image_url = imageUrl;
    if (editing) data.id = fields.banner_id.value;
    action(form.querySelector("[type=submit]"), async () => {
      await api("/api/admin/banners", data);
      resetForm();
      await loadData();
      showFeedback(editing ? "Баннер обновлён." : "Баннер добавлен.");
    });
  });
  imageFile.addEventListener("change", () => {
    const file = imageFile.files[0];
    const version = ++imageReadVersion;
    const submit = form.querySelector("[type=submit]");
    submit.disabled = false;
    imageData = "";
    if (!file) {
      showPreview(currentImage || form.elements.image_url.value, currentImage ? currentMime : "");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp", "video/mp4"].includes(file.type) || file.size > 750 * 1024) {
      imageFile.value = "";
      showPreview(currentImage || form.elements.image_url.value, currentImage ? currentMime : "");
      showFeedback("Выберите PNG, JPEG, WebP или MP4 размером до 750 КБ.", true);
      return;
    }
    const reader = new FileReader();
    submit.disabled = true;
    reader.onload = () => {
      if (version !== imageReadVersion) return;
      imageData = String(reader.result);
      showPreview(imageData);
      submit.disabled = false;
      showFeedback("");
    };
    reader.onerror = () => {
      if (version !== imageReadVersion) return;
      submit.disabled = false;
      imageFile.value = "";
      showFeedback("Не удалось прочитать файл. Выберите его ещё раз.", true);
    };
    reader.readAsDataURL(file);
  });
  form.elements.image_url.addEventListener("input", () => {
    if (!imageData) showPreview(form.elements.image_url.value || currentImage, form.elements.image_url.value ? "" : currentMime);
  });
  document.querySelector("[data-clear-image]").addEventListener("click", () => {
    imageFile.value = "";
    imageData = "";
    imageReadVersion++;
    form.querySelector("[type=submit]").disabled = false;
    showPreview(form.elements.image_url.value || currentImage, form.elements.image_url.value ? "" : currentMime);
  });
  cancelEdit.addEventListener("click", resetForm);
  resultSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    renderResults();
    searchTimer = window.setTimeout(() => loadData().catch((error) => {
      showFeedback(error.message || "Не удалось выполнить поиск. Попробуйте ещё раз.", true);
    }), 250);
  });
  document.querySelector("[data-logout]").addEventListener("click", (event) => action(event.currentTarget, async () => {
    await api("/api/admin/logout", {});
    window.location.reload();
  }));
  document.querySelector("[data-reload]").addEventListener("click", (event) => action(event.currentTarget, loadData));
  loadData().catch((error) => {
    document.querySelector("[data-loading]").hidden = true;
    showFeedback(error.message || "Не удалось загрузить данные. Нажмите «Обновить».", true);
    if (error.status === 401) window.setTimeout(() => window.location.reload(), 1400);
  });
})();
