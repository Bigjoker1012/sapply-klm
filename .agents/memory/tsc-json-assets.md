---
name: tsc не копирует JSON в dist
description: Скрипты, читающие JSON из src через __dirname, ломаются после tsc-сборки. Резолвить путь устойчиво или копировать на build.
---

`tsc` копирует в `outDir` только `.ts`/`.js`/`.d.ts`. Любые ассеты рядом (JSON-снимки, фикстуры, шаблоны писем, миграционные SQL — если их не отдельным таргетом копировать) остаются в `src/` и при запуске из `dist/` через `__dirname` дают `ENOENT`.

**Правило для любого скрипта, читающего файл рядом с собой:**
1. Не полагаться только на `__dirname`. Сделать список кандидатов:
   - `path.resolve(__dirname, '../относительно/src.json')` — работает в ts-node/dev.
   - `path.resolve(process.cwd(), 'server/src/относительно/src.json')` — работает из `dist/` если запуск из корня репо (npm-скрипты всегда так делают).
   - Опционально: env-переменная `SEED_CATALOG_PATH` для prod-окружения, если репо-структура отличается.
2. Бросить понятную ошибку со списком проверенных путей, чтобы дебажить за 5 секунд.
3. Альтернатива на build: добавить `cp -R src/**/seed-data dist/...` в `build:server` или включить `"resolveJsonModule": true` + `import data from './seed.json'` — тогда JSON попадёт в бандл через require и не зависит от FS.

**Why:** ts-node прячет эту проблему — всё работает локально, ломается только в проде после `npm run build && node dist/...`. Подтверждено трижды: JSON-снимок каталога (`seed-catalog.ts`), папка SQL-миграций (`migrate.ts`, падал с `Migrations folder not found`) и Python-скрипт OCR (`pdfParser.ts` зовёт `python3 dist/.../ocr_recipe.py` — `.py` тоже не копируется). Любой не-`.ts`/`.js` файл рядом с кодом — потенциальная мина.

Доп. грабли с Python-скриптами и зависимостями в ЭТОМ репле:
- `.pythonlibs` — это `PYTHONUSERBASE` (пакеты ставятся через `pip --user`), а НЕ uv-venv: в нём НЕТ `pyvenv.cfg`. PyMuPDF/`fitz` уже лежит там и попадает в снимок VM-деплоя (gitignore на деплой не влияет).
- НЕ добавлять pip-зависимости в `pyproject.toml` `dependencies`. Деплой на этапе Build гоняет `uv sync`; при пустом `dependencies=[]` это no-op и проходит, но как только появляется зависимость — uv пытается поставить её в read-only nix store python (`UV_PYTHON_PREFERENCE=only-system`, валидного venv нет) и падает с `Permission denied (os error 13)`, ломая публикацию. Это уже ловилось: добавил `pymupdf>=1.27` → Build упал → откатил обратно в `dependencies=[]`.
- Системные бинарники (tesseract+`rus`, mupdf/pdftoppm) брать через `replit.nix` — он детерминирован для dev и деплоя.

**Why:** платформенный uv в этом репле не видит `.pythonlibs` как управляемое окружение, поэтому любая декларация зависимости приводит к попытке записи в неизменяемый nix store. Управление Python-пакетами тут — через pip-user, а доставка в прод — через снимок workspace, а не через `pyproject`/`uv sync`.

**How to apply:** при создании нового CLI-скрипта в `server/src/scripts/`, если он читает что-то относительно себя — сразу резолвить через массив кандидатов; не оставлять «потом починим».
