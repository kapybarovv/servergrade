import adminClientSource from "./admin-client.js";

const icons = {
  arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  edit: '<path d="m16 3 5 5M4 20l4-1 13-13a2.1 2.1 0 0 0-3-3L5 16z"/>',
  trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
  pin: '<path d="m16 3 5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4zM2 22l6-6"/>',
  logout: '<path d="M9 21H4V3h5M10 12h11m-4-4 4 4-4 4"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ""}</svg>`;
}

const styles = `
.image-preview {
  grid-column:1/-1
}
.field input[type=file] {
  height:auto;
  min-height:43px;
  padding:8px;
  font-size:12px
}
.field input[type=file]::file-selector-button {
  border:0;
  border-radius:999px;
  background:#2a3930;
  color:#d8e8dd;
  padding:7px 11px;
  margin-right:10px;
  font:inherit;
  cursor:pointer
}
.field-hint {
  color:#7f8e84;
  font-size:11px;
  line-height:1.5
}
.image-preview {
  display:flex;
  align-items:center;
  gap:15px;
  padding:12px;
  background:#121a14;
  border:1px solid #29382d;
  border-radius:13px;
  min-width:0
}
.image-preview img,.image-preview video {
  width:128px;
  height:78px;
  object-fit:contain;
  max-width:45%;
  border-radius:8px;
  background:#090c0a
}
.image-preview div {
  min-width:0;
  flex:1;
  font-size:12px;
  color:#a0b0a5;
  line-height:1.6
}
.image-preview button {
  margin-top:5px
}
:root {
  color-scheme:dark;
  font-family:Manrope,system-ui,sans-serif;
  color:#eceeed;
  background:#0b0d0c;
  font-synthesis:none;
  font-optical-sizing:auto;
  --green:#36d993;
  --muted:#8c9690;
  --border:#262c28
}
* {
  box-sizing:border-box
}
body {
  margin:0
}
button,input {
  font:inherit
}
a {
  color:inherit;
  text-decoration:none
}
button,a,input {
  touch-action:manipulation
}
button {
  cursor:pointer
}
button:disabled {
  cursor:wait;
  opacity:.55
}
button,input {
  max-width:100%
}
.icon {
  width:18px;
  height:18px;
  flex:none
}
button .icon {
  pointer-events:none
}
.wrap {
  width:min(1120px,calc(100% - 48px));
  margin:auto
}
.header {
  border-bottom:1px solid #1c221e
}
.nav {
  min-height:78px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px
}
.brand {
  display:inline-flex;
  align-items:center;
  gap:11px;
  font-family:Montserrat,sans-serif;
  font-size:18px;
  font-weight:700;
  letter-spacing:-.7px
}
.brand-mark {
  width:21px;
  height:27px;
  position:relative;
  flex:none
}
.brand-mark:before,.brand-mark:after {
  content:"";
  position:absolute;
  background:var(--green);
  border-radius:3px;
  transform:skew(-18deg)
}
.brand-mark:before {
  width:10px;
  height:20px;
  left:9px;
  top:0
}
.brand-mark:after {
  width:19px;
  height:7px;
  left:0;
  bottom:0
}
.nav-actions {
  display:flex;
  align-items:center;
  gap:10px
}
.nav-label {
  color:var(--muted);
  font-size:12px
}
.button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  min-height:42px;
  padding:10px 18px;
  border-radius:999px;
  border:1px solid transparent;
  background:var(--green);
  color:#082618;
  font-size:13px;
  font-weight:700;
  line-height:1.35;
  white-space:nowrap;
  transition:background-color .16s,transform .16s,border-color .16s
}
.button:hover {
  background:#60e6aa
}
.button:active {
  transform:scale(.98)
}
.button.secondary,.icon-button {
  background:#181d19;
  border:1px solid var(--border);
  color:#e0e6e1
}
.button.secondary:hover,.icon-button:hover {
  background:#252d27;
  border-color:#3d4c41
}
.button.danger {
  color:#f2aaaa
}
.button.small {
  min-height:36px;
  padding:8px 13px;
  font-size:12px
}
.icon-button {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none;
  width:36px;
  height:36px;
  border-radius:50%;
  transition:background-color .16s
}
.icon-button.danger {
  color:#f2aaaa
}
:focus-visible {
  outline:2px solid var(--green);
  outline-offset:4px
}
input:focus-visible {
  outline-offset:1px
}
main {
  padding:48px 0 64px
}
.page-heading {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:24px;
  margin-bottom:30px
}
h1,h2,p {
  margin:0
}
h1,h2 {
  font-family:Montserrat,sans-serif;
  font-weight:650;
  letter-spacing:-.8px
}
h1 {
  font-size:30px;
  line-height:1.2
}
h2 {
  font-size:19px;
  line-height:1.3;
  letter-spacing:-.4px
}
.page-heading p,.section-heading p {
  margin-top:9px;
  color:var(--muted);
  font-size:13px;
  line-height:1.6
}
.panel {
  background:#111512;
  border:1px solid var(--border);
  border-radius:22px;
  padding:26px;
  min-width:0
}
.panel+.panel {
  margin-top:26px
}
.section-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  margin-bottom:24px
}
.count {
  color:var(--muted);
  font-size:12px;
  white-space:nowrap
}
.status {
  font-size:13px;
  line-height:1.55;
  overflow-wrap:anywhere
}
.status:not(:empty) {
  padding:13px 16px;
  margin-bottom:22px;
  border:1px solid #315442;
  border-radius:14px;
  background:#15291d;
  color:#abebc4
}
.status.error {
  border-color:#603535;
  background:#291919;
  color:#ffc0c0
}
.status[hidden] {
  display:none
}
.muted {
  color:var(--muted)
}
.banner-form {
  padding:20px;
  background:#0d100e;
  border:1px solid #202822;
  border-radius:16px
}
.form-grid {
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  gap:17px
}
.field {
  display:grid;
  gap:8px;
  font-size:12px;
  color:#bdc6bf;
  min-width:0
}
.field.wide {
  grid-column:1/-1
}
.field input,.search {
  width:100%;
  height:43px;
  padding:10px 13px;
  border:1px solid #2a332d;
  border-radius:12px;
  background:#171d18;
  color:#f0f4f1;
  font-size:14px;
  min-width:0
}
.field input::placeholder,.search::placeholder {
  color:#647169
}
.field input:focus,.search:focus {
  border-color:#55b882
}
.form-bottom {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  flex-wrap:wrap;
  margin-top:20px
}
.form-options {
  display:flex;
  align-items:center;
  gap:22px;
  flex-wrap:wrap
}
.toggle {
  display:flex;
  align-items:center;
  gap:9px;
  font-size:13px;
  color:#d9e1db;
  cursor:pointer
}
.toggle input {
  appearance:none;
  width:34px;
  height:21px;
  border:1px solid #354038;
  border-radius:999px;
  background:#303831;
  position:relative;
  margin:0;
  transition:background-color .16s;
  cursor:pointer
}
.toggle input:before {
  content:"";
  position:absolute;
  top:3px;
  left:3px;
  width:13px;
  height:13px;
  border-radius:50%;
  background:#b5beb7;
  transition:transform .16s,background-color .16s
}
.toggle input:checked {
  background:#266241;
  border-color:#448862
}
.toggle input:checked:before {
  background:#a8efc3;
  transform:translateX(13px)
}
.order-field {
  display:flex;
  align-items:center;
  gap:8px;
  font-size:12px;
  color:var(--muted)
}
.order-field input {
  width:70px;
  height:35px;
  background:#171d18;
  border:1px solid #2a332d;
  border-radius:10px;
  padding:7px 9px;
  color:#e9efea;
  font-size:14px
}
.form-actions {
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap
}
.banner-list {
  display:grid;
  gap:12px;
  margin-top:20px
}
.banner-card {
  display:flex;
  align-items:center;
  gap:16px;
  min-width:0;
  padding:13px;
  border:1px solid #252e28;
  border-radius:15px;
  background:#141a16
}
.banner-image {
  display:block;
  width:132px;
  height:74px;
  flex:none;
  border-radius:9px;
  object-fit:contain;
  background:#0a0d0b
}
.banner-info {
  flex:1;
  min-width:0
}
.banner-title {
  font-size:13px;
  font-weight:700;
  overflow-wrap:anywhere
}
.banner-link {
  display:block;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:11px;
  color:var(--muted);
  margin-top:5px;
  max-width:100%
}
.banner-meta {
  display:flex;
  align-items:center;
  gap:8px;
  margin-top:8px;
  color:#78867d;
  font-size:11px
}
.badge {
  display:inline-flex;
  align-items:center;
  min-height:22px;
  padding:3px 8px;
  border-radius:999px;
  background:#28312b;
  color:#a4b1a8;
  font-size:10px;
  white-space:nowrap
}
.badge.enabled {
  background:#1e3929;
  color:#9ae1b6
}
.banner-actions {
  display:flex;
  align-items:center;
  gap:7px
}
.empty {
  padding:28px 16px;
  text-align:center;
  color:var(--muted);
  font-size:13px;
  line-height:1.6;
  border:1px dashed #29332c;
  border-radius:14px
}
.results-toolbar {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin-bottom:18px
}
.search-wrap {
  position:relative;
  width:min(380px,100%)
}
.search-wrap>.icon {
  position:absolute;
  top:13px;
  left:14px;
  color:#839088;
  pointer-events:none
}
.search {
  padding-left:41px;
  border-radius:999px;
  background:#171d18
}
.table-scroll {
  overflow-x:auto;
  border:1px solid #252e28;
  border-radius:15px
}
table {
  border-collapse:collapse;
  width:100%;
  text-align:left;
  font-size:12px
}
th {
  padding:13px 15px;
  background:#171c18;
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:.6px;
  color:#829087;
  font-weight:600
}
td {
  padding:14px 15px;
  border-top:1px solid #222a25;
  vertical-align:middle
}
tr:hover td {
  background:#171e19
}
.test-id {
  font-weight:700;
  white-space:nowrap
}
.test-id:hover {
  color:#99e7b8
}
.server {
  min-width:0
}
.server-name {
  font-size:12px;
  font-weight:600
}
.cpu {
  max-width:300px;
  margin-top:4px;
  font-size:11px;
  color:var(--muted);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap
}
.rating {
  font-size:16px;
  font-weight:700;
  color:#82daa7
}
.date {
  font-size:11px;
  color:var(--muted);
  white-space:nowrap
}
.pin-cell {
  text-align:right
}
.pin-button {
  min-width:115px
}
.pin-button[aria-pressed=true] {
  background:#1d3426;
  color:#a3e2ba;
  border-color:#3a6046
}
.pin-button[aria-pressed=true] .icon {
  fill:currentColor
}
.skeleton {
  height:76px;
  border-radius:14px;
  background:#19201b;
  animation:pulse 1.5s ease-in-out infinite
}
.skeleton+.skeleton {
  margin-top:10px
}
@keyframes pulse {
  50% {
    opacity:.4
  }
}
.login-wrap {
  width:min(420px,100%);
  margin:70px auto
}
.login-wrap h1 {
  font-size:26px
}
.login-wrap p {
  margin:12px 0 28px;
  font-size:13px;
  line-height:1.6;
  color:var(--muted)
}
.login-wrap .button {
  width:100%;
  margin-top:20px
}
.login-wrap .status {
  margin:20px 0 0
}
.footer {
  padding:0 0 32px;
  font-size:11px;
  color:#68766d
}
.footer a:hover {
  color:#b2c2b7
}
[hidden] {
  display:none!important
}
@media(max-width:680px) {
  .wrap {
    width:calc(100% - 28px)
  }
  .nav {
    min-height:68px;
    gap:12px
  }
  .brand {
    font-size:16px
  }
  .nav-label {
    display:none
  }
  .nav-actions .button {
    min-height:36px;
    padding:8px 12px;
    font-size:12px
  }
  main {
    padding:30px 0 38px
  }
  h1 {
    font-size:26px
  }
  .page-heading {
    margin-bottom:24px
  }
  .panel {
    padding:18px;
    border-radius:18px
  }
  .panel+.panel {
    margin-top:18px
  }
  .section-heading {
    align-items:flex-start;
    gap:12px
  }
  .section-heading p {
    font-size:12px
  }
  .banner-form {
    padding:15px
  }
  .form-grid {
    grid-template-columns:minmax(0,1fr)
  }
  .field.wide {
    grid-column:auto
  }
  .field input,.search,.order-field input {
    font-size:16px
  }
  .form-bottom,.form-options {
    gap:16px
  }
  .form-actions {
    width:100%
  }
  .form-actions .button {
    flex:1;
    min-height:42px
  }
  .banner-card {
    gap:12px;
    flex-wrap:wrap
  }
  .banner-image {
    width:96px;
    height:62px
  }
  .banner-info {
    flex-basis:calc(100% - 108px)
  }
  .banner-actions {
    width:100%;
    justify-content:flex-end;
    padding-top:2px
  }
  .banner-meta {
    flex-wrap:wrap
  }
  .results-toolbar {
    align-items:flex-start;
    flex-direction:column;
    gap:12px
  }
  .search-wrap {
    width:100%
  }
  .table-scroll {
    border-radius:12px
  }
  th,td {
    padding:12px 10px
  }
  .cpu {
    max-width:175px
  }
  .date-col {
    display:none
  }
  .pin-button {
    min-width:36px;
    width:36px;
    height:36px;
    padding:8px!important
  }
  .pin-button span {
    display:none
  }
  .pin-button .icon {
    width:17px;
    height:17px
  }
  .rating {
    font-size:14px
  }
  .test-id {
    font-size:11px
  }
  .login-wrap {
    margin:36px auto
  }
  .count {
    font-size:11px
  }
}
@media(max-width:380px) {
  .cpu {
    max-width:125px
  }
  .server-name {
    font-size:11px
  }
  .rating-col {
    display:none
  }
  .banner-image {
    width:80px;
    height:54px
  }
  .banner-info {
    flex-basis:calc(100% - 92px)
  }
}
@media(prefers-reduced-motion:reduce) {
  *,*:before,*:after {
    animation:none!important;
    transition:none!important
  }
}
`;


export function renderAdminPage(authenticated = false) {
  const body = authenticated ? `
    <main>
      <div class="page-heading"><div><h1>Управление</h1><p>Баннеры и закреплённые замеры</p></div><button class="button secondary small" type="button" data-reload>Обновить</button></div>
      <div class="status" data-feedback hidden role="status" aria-live="polite"></div>
      <div data-loading aria-label="Загрузка данных"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div data-admin-content hidden>
        <section class="panel" aria-labelledby="banners-title">
          <div class="section-heading"><div><h2 id="banners-title">Баннеры</h2><p>Порядок отображения — от меньшего к большему.</p></div><span class="count" data-banner-count></span></div>
          <form class="banner-form" data-banner-form>
            <input type="hidden" name="banner_id">
            <div class="form-grid">
              <label class="field wide">Название<input name="title" maxlength="120" required placeholder="Название баннера" autocomplete="off"></label>
              <label class="field">Загрузить баннер<input type="file" name="image_file" accept="image/png,image/jpeg,image/webp,video/mp4"><span class="field-hint">PNG, JPEG, WebP или MP4 до 750 КБ. Файл сохранится на сайте.</span></label>
              <label class="field">Или ссылка на баннер<input type="url" name="image_url" maxlength="2048" placeholder="https://example.com/banner.webp" inputmode="url" autocomplete="off"><span class="field-hint">При редактировании оставьте поле пустым, чтобы сохранить загруженный файл.</span></label>
              <div class="image-preview wide" data-image-preview hidden><img alt="Предпросмотр баннера"><video muted autoplay loop playsinline controls preload="metadata" aria-label="Предпросмотр видеобаннера" hidden></video><div><span data-image-label></span><br><button class="button secondary small" type="button" data-clear-image>Сбросить выбор</button></div></div>
              <label class="field wide">Ссылка при нажатии<input type="url" name="target_url" maxlength="2048" required placeholder="https://example.com" inputmode="url" autocomplete="off"></label>
            </div>
            <div class="form-bottom"><div class="form-options"><label class="toggle"><input type="checkbox" name="enabled" checked>Показывать на сайте</label><label class="order-field">Порядок<input type="number" name="sort_order" value="0" min="0" max="9999" step="1" required></label></div><div class="form-actions"><button class="button secondary" type="button" data-cancel-edit hidden>Отмена</button><button class="button" type="submit">${icon("plus")}<span data-save-label>Добавить баннер</span></button></div></div>
          </form>
          <div class="banner-list" data-banner-list></div>
        </section>
        <section class="panel" aria-labelledby="pins-title">
          <div class="section-heading"><div><h2 id="pins-title">Закреплённые замеры</h2><p>Закреплённые тесты отображаются на главной странице.</p></div><span class="count" data-pin-count></span></div>
          <div class="results-toolbar"><label class="search-wrap">${icon("search")}<input class="search" type="search" data-result-search placeholder="ID, локация или процессор" aria-label="Поиск по замерам" autocomplete="off"></label><span class="count" data-results-count></span></div>
          <div class="table-scroll"><table><thead><tr><th>ID</th><th>Сервер</th><th class="rating-col">Рейтинг</th><th class="date-col">Дата</th><th class="pin-cell">Закрепление</th></tr></thead><tbody data-results-body></tbody></table></div>
        </section>
      </div>
    </main>` : `
    <main><section class="panel login-wrap"><h1>Вход в управление</h1><p>Введите пароль администратора.</p><form data-login method="post" action="/api/admin/login"><label class="field">Пароль<input type="password" name="password" required autocomplete="current-password" autofocus></label><button class="button" type="submit">Войти</button></form><div class="status" data-feedback hidden role="status" aria-live="polite"></div></section></main>`;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Управление · ServerGrade</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Montserrat:wght@600;700&display=swap" rel="stylesheet"><style>${styles}</style></head><body data-authenticated="${Boolean(authenticated)}"><header class="header"><nav class="wrap nav"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>ServerGrade</a><div class="nav-actions"><span class="nav-label">Панель управления</span>${authenticated ? `<button class="button secondary" type="button" data-logout>${icon("logout")}Выйти</button>` : `<a class="button secondary" href="/">На сайт ${icon("arrow")}</a>`}</div></nav></header><div class="wrap">${body}<footer class="footer"><a href="/">servergrade.cc</a></footer></div><script>${adminClientSource}</script></body></html>`;
}
