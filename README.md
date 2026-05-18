diff --git a/README.md b/README.md
index 2a575df1506eb34e58b3e87e53e20a5b7a47462a..7d671fcfe17df496e106b4f2b2ceb3767311b0da 100644
--- a/README.md
+++ b/README.md
@@ -9,56 +9,164 @@ ERP-система для управления сырьём: остатки, р
 
 ## Быстрый запуск
 
 ### 1. База данных
 ```bash
 sudo -u postgres psql < database.sql
 ```
 
 ### 2. Backend
 ```bash
 cd backend
 npm install
 cp .env.example .env   # заполни переменные
 npm run dev
 ```
 
 ### 3. Frontend
 ```bash
 cd frontend
 npm install
 npm start
 ```
 
 ### 4. Production
 ```bash
-# Backend
-cd backend && npm run build && npm start
+# Full-stack сборка из корня репозитория
+npm ci --include=dev
+npm run build
+npm start
+```
+
+### 5. Railway / Rainway deploy
+
+Деплой нужно запускать из **корня репозитория**, а не из папок `backend/` или `frontend/`.
+В корне уже есть `railway.json` и `nixpacks.toml`: Railway установит зависимости через
+`npm ci --include=dev`, соберёт React-клиент и TypeScript-сервер командой `npm run build`,
+а затем запустит `npm start`.
+
+В переменных окружения Railway укажи минимум:
+
+```
+NODE_ENV=production
+DATABASE_URL=<PostgreSQL URL из Railway>
+JWT_SECRET=<длинная случайная строка>
+```
+
+Если в логах появляется `DATABASE_URL не найдена в переменных окружения`:
+
+1. Убедись, что в проекте Railway есть PostgreSQL service.
+2. Открой именно service приложения → **Variables** → **New Variable**.
+3. Создай переменную `DATABASE_URL` и значением выбери reference на базу через autocomplete: `${{Postgres.DATABASE_URL}}`
+   (если service базы называется иначе, выбери его фактическое имя).
+4. Нажми **Deploy staged changes** / redeploy приложения.
+
+`/api/health` специально отвечает `200 OK` даже если БД ещё не настроена: в ответе смотри поле
+`db.status` (`connected`, `error` или `not_configured`). Это нужно, чтобы Railway не убивал контейнер
+раньше времени, а проблему с БД можно было увидеть в логах и в health payload.
+
+Приложение также умеет подключаться без `DATABASE_URL`, если в service приложения переданы переменные
+`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` или локальные `DB_HOST`, `DB_PORT`,
+`DB_USER`, `DB_PASSWORD`, `DB_NAME`.
+
+
+## Подключение Railway, базы и Google Sheets
+
+### 1. База данных на Railway
+
+1. В Railway создай PostgreSQL service в том же project, где находится приложение.
+2. В service приложения → **Variables** добавь:
+
+```
+DATABASE_URL=${{Postgres.DATABASE_URL}}
+NODE_ENV=production
+JWT_SECRET=<длинная случайная строка>
+ADMIN_SETUP_TOKEN=<длинная случайная строка для init/sync endpoint-ов>
+```
+
+Если PostgreSQL service называется не `Postgres`, выбери его `DATABASE_URL` через autocomplete Railway.
+
+3. После redeploy проверь:
+
+```bash
+curl https://<your-app>.up.railway.app/api/health
+```
+
+Ожидаемый признак подключения: `"db":{"status":"connected"}`.
+
+Актуальный ответ `/api/health` должен содержать поле `service`: `root-server` для деплоя из корня репозитория или `backend-service`, если Railway запускает отдельную папку `backend`. Если ответ состоит только из `{"status":"ok","message":"Server is running"}` без `db`, Railway показывает старый deploy или другой service/root directory — сделай redeploy последнего commit и проверь настройки **Root Directory** / **Start Command**.
+
+Если в Railway build/deploy log видно `Healthcheck succeeded!`, контейнер уже живой.
+Предупреждения Docker/Nixpacks вида `SecretsUsedInArgOrEnv` и `UndefinedVar: $NIXPACKS_PATH` не являются причиной падения деплоя, если healthcheck успешен. После этого нужно переходить к настройке runtime-переменных БД и Google Sheets в **App Service → Variables**.
+
+Если в build plan всё ещё отображается `npm install --include=dev` вместо `npm ci --include=dev`, проверь, что Railway деплоит последний commit с `nixpacks.toml`, и что в Railway UI не задан кастомный Install Command, который переопределяет файл.
+
+4. Один раз создай таблицы в Railway PostgreSQL:
+
+```bash
+curl -X POST https://<your-app>.up.railway.app/api/admin/init-db \
+  -H "x-admin-token: <ADMIN_SETUP_TOKEN>" \
+  -H "content-type: application/json" \
+  -d '{"seedDemoData":true}'
+```
+
+`seedDemoData` можно поставить `false`, если не нужны тестовые строки.
+
+### 2. Google Sheets
+
+1. Создай Google Cloud service account и включи Google Sheets API.
+2. Поделись нужной таблицей с email service account.
+3. В Railway → service приложения → **Variables** добавь:
 
-# Frontend
-cd frontend && npm run build
-# build/ подключается к backend через express.static
+```
+GOOGLE_SHEETS_SPREADSHEET_ID=<id таблицы из URL>
+GOOGLE_SHEETS_CLIENT_EMAIL=<service-account@project.iam.gserviceaccount.com>
+GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
+GOOGLE_SHEETS_RAW_MATERIALS_RANGE=raw_materials!A:E
+```
+
+Лист `raw_materials` должен иметь заголовки в первой строке. Поддерживаемые колонки:
+
+| Колонка | Можно назвать | Назначение |
+|---|---|---|
+| UID | `uid`, `код`, `code`, `артикул` | уникальный код сырья |
+| Name | `name`, `наименование`, `название`, `сырье` | название сырья |
+| Avg monthly consumption | `avg_monthly_consumption`, `среднемесячный расход`, `расход` | среднемесячный расход |
+| Purchase threshold | `purchase_threshold`, `порог закупки`, `порог` | порог закупки |
+| Synonyms | `synonyms`, `синонимы`, `aliases` | синонимы через `;` или `,` |
+
+4. Проверить настройку Google Sheets:
+
+```bash
+curl https://<your-app>.up.railway.app/api/integrations/google-sheets/status
+```
+
+5. Запустить синхронизацию сырья из Google Sheets в PostgreSQL:
+
+```bash
+curl -X POST https://<your-app>.up.railway.app/api/integrations/google-sheets/sync/raw-materials \
+  -H "x-admin-token: <ADMIN_SETUP_TOKEN>"
 ```
 
 ## .env переменные
 
 ```
 PORT=3001
 DB_HOST=localhost
 DB_PORT=5432
 DB_USER=postgres
 DB_PASSWORD=your_password
 DB_NAME=erp_supply
 JWT_SECRET=your_jwt_secret
 GOOGLE_SHEETS_SPREADSHEET_ID=1XLQ1FSJOXLwIgEhbAtz95yrVXbEzBYQkAgQ5XEnLxOA
 ```
 
 ## API эндпоинты
 
 | Метод | URL | Описание |
 |-------|-----|----------|
 | GET | /api/dashboard/decisions | Управленческие решения |
 | GET | /api/dashboard/export | Экспорт в Excel |
 | GET | /api/dashboard/status | Статус обновлений |
 | POST | /api/upload/polotsk | Загрузка остатков Полоцка (PDF/Excel) |
 | POST | /api/upload/recipe | Загрузка рецепта (PDF/Excel) |
 | GET | /api/upload/unmatched | Нераспознанные строки |
