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

6. Проверьте выдачу одноразового challenge:

   ```bash
   curl -X POST https://servergrade-results.<account>.workers.dev/api/challenges
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

## Модель подтверждения

Runner перед тестом получает `test_id` и одноразовый `nonce` через
`POST /api/challenges`. Challenge действует два часа и привязан HMAC-хэшем к
исходному IP. При публикации Worker проверяет nonce и IP, один раз погашает
challenge и сам считает все четыре оценки только из raw-метрик. Поля score от
клиента игнорируются.

Результаты без корректного challenge принимаются как `unverified` для обратной
совместимости и не должны участвовать в рейтингах. Для подтверждённых запусков
Worker сохраняет ASN, страну, edge-локацию и RTT, полученные Cloudflare на
входящем соединении. Это edge-attestation, а не внешняя проверка полосы: для
последней нужны отдельные probe-серверы.

После записи результат не изменяется и получает серверную HMAC-подпись.
Одноразовый токен загрузки SVG хранится только в виде хэша, действует 10 минут
и удаляется сразу после загрузки заявленного числа страниц. Повторная запись
страницы запрещена.
