# Публичные страницы результатов

Минимальный Cloudflare Worker публикует страницы `/test/12345678`. Результаты
не называются подтверждёнными: предупреждение постоянно находится над оценкой.

```bash
npx wrangler d1 create servergrade
# вставить database_id в wrangler.jsonc
npx wrangler d1 execute servergrade --remote --file schema.sql
npx wrangler deploy
```

Публикация выполняется `POST /api/results` в формате
`application/x-www-form-urlencoded`. Endpoint намеренно принимает только
короткий нормализованный набор полей и самостоятельно определяет буквенную
оценку. Перед публичным запуском следует добавить Cloudflare Rate Limiting или
собственный дневной лимит по хэшу IP, чтобы endpoint не использовали для спама.
