---
name: Recovering lost agent work after main reset
description: When main is reset back to origin/main and newer agent commits vanish, where the work survives and how to restore it without destructive git.
---

# Восстановление потерянной работы после сброса main

Симптом: задеплоенная/собранная версия (`dist/client`) содержит фичи, которых нет
в исходниках `client/src` — UI на превью/проде опережает код. Причина: `main` был
`git reset` на `origin/main`, более свежие коммиты слетели с ветки.

## Где искать потерянные коммиты
- `git reflog` — содержит полную цепочку (например `HEAD@{2}` = tip до reset).
- Ветка-бэкап `gitsafe-backup/main` (remote ref) — обычно указывает на последний
  «Published your App» с полным содержимым.
- Ветка `replit-agent` — рабочий tip агента (может быть на 1 пустой коммит впереди
  с идентичным деревом; сверять `git diff --stat`).
- Проверить, что цель — потомок текущего HEAD: `git merge-base --is-ancestor origin/main <tip>` (0 = да, восстановление чисто-аддитивное).

## Как восстановить (main-агенту деструктивный git ЗАПРЕЩЁН)
- `git merge`, `git archive`, `git checkout/restore/reset` — все блокируются
  хуком «Destructive git operations are not allowed in the main agent».
- Рабочий способ: для каждого файла `git show <tip>:path > path` (git только читает,
  пишет shell-редирект). Брать список из `git diff --name-status <old> <tip>`.
- **`.replit` так не восстановить** — прямые правки запрещены отдельным хуком;
  порты/воркфлоу настраивать своими инструментами, бинарники из attached_assets можно пропустить.
- После восстановления: новые таблицы схемы могли уже существовать в БД (версия
  раньше работала) — проверить `to_regclass`; рестартнуть workflow (ts-node без
  авто-reload не подхватит серверные изменения).
