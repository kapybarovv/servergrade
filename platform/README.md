# Публичные страницы результатов

Cloudflare Worker публикует страницы `/test/12345678`, принимает полные метрики
runner и хранит SVG-страницы отчёта вместе с результатом в D1.

## Развёртывание

1. Установите Node.js, откройте этот каталог и поставьте локальный Wrangler:

   ```bash
   cd platform
   npm install
   npx wrangler login
   ```

2. Создайте бесплатную D1-базу ближе к основной аудитории:

   ```bash
   npx wrangler d1 create servergrade --location=weur
   ```

3. Скопируйте выданный `database_id` в `wrangler.jsonc`, заменив
   ID базы уже указан в `wrangler.jsonc`. Binding должен остаться `DB`.

4. Создайте таблицу сначала локально и проверьте Worker:

   ```bash
   npm run db:local
   npm run dev
   ```

   Откройте `http://localhost:8787`.

5. Создайте таблицу в production D1 и опубликуйте Worker:

   ```bash
   npm run db:remote
   npm run deploy
   ```

   Wrangler покажет адрес вида
   `https://servergrade-results.<account>.workers.dev`.

6. Проверьте ручную публикацию:

   ```bash
   curl -X POST https://servergrade-results.<account>.workers.dev/api/results \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     --data-urlencode 'score=84' \
     --data-urlencode 'network_score=90' \
     --data-urlencode 'performance_score=81' \
     --data-urlencode 'quality_score=79' \
     --data-urlencode 'coverage=100' \
     --data-urlencode 'country=NL' \
     --data-urlencode 'city=Amsterdam' \
     --data-urlencode 'cpu=AMD EPYC' \
     --data-urlencode 'cores=4' \
     --data-urlencode 'ram=8 GiB' \
     --data-urlencode 'ram_type=DDR4' \
     --data-urlencode 'disk=100 GiB' \
     --data-urlencode 'disk_type=NVMe SSD' \
     --data-urlencode 'disk_model=Samsung PM9A3' \
     --data-urlencode 'server_vendor=Supermicro'
   ```

7. После развёртывания официального API обычному пользователю ничего настраивать
   не нужно. Runner уже содержит endpoint
   `https://servergrade-results.kapybarovv.workers.dev/api/results`:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/kapybarovv/servergrade/main/servergrade.sh)
   ```

8. Для своего домена откройте Cloudflare Dashboard → **Workers & Pages** →
   **servergrade-results** → **Settings** → **Domains & Routes** → **Add** →
   **Custom Domain** и укажите `servergra.de`. Cloudflare создаст DNS-запись и
   сертификат. После этого используйте
   `https://servergra.de/api/results`. Для проверки до подключения домена можно
   временно переопределить endpoint только у владельца проекта:

   ```bash
   SERVERGRADE_PUBLISH_URL=https://servergrade-results.<account>.workers.dev/api/results servergrade
   ```

Публикация выполняется `POST /api/results` в формате
`application/x-www-form-urlencoded`. Endpoint намеренно принимает только
короткий нормализованный набор полей и самостоятельно определяет буквенную
оценку. Перед публичным запуском следует добавить Cloudflare Rate Limiting или
собственный дневной лимит по хэшу IP, чтобы endpoint не использовали для спама.
