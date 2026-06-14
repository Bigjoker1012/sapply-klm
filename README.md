# SUPPLY-KLM | Управление снабжением

ERP-система для управления сырьём: остатки, рецепты, транзит, принятие решений о закупке.

## Стек
- **Backend:** Node.js + Express + TypeScript + PostgreSQL
- **Frontend:** React + TypeScript + Tailwind CSS
- **Парсинг:** pdf-parse (PDF), xlsx (Excel)

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
# Backend
cd backend && npm run build && npm start

# Frontend
cd frontend && npm run build
# build/ подключается к backend через express.static
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
| POST | /api/upload/unmatched/confirm | Подтвердить маппинг |
| GET | /api/raw-materials | Справочник сырья |
| GET | /api/in-transit | Сырьё в пути |
| POST | /api/in-transit | Добавить поставку |
| DELETE | /api/in-transit/:id | Удалить поставку |
| GET | /api/synonyms | База синонимов |
| POST | /api/synonyms | Добавить синоним |
| DELETE | /api/synonyms/:id | Удалить синоним |
| GET | /api/inventory/polotsk | Остатки Полоцка |
| GET | /api/inventory/lipkovskaya | Остатки Липковской |
| POST | /api/inventory/lipkovskaya | Ввести остатки Липковской |
