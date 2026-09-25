---
name: GitHub push из этого Repl
description: Как пушить в GitHub из этого окружения — авторизация идёт через коннектор, не через git credential helper
---

# Push в GitHub из этого Repl

В окружении НЕ настроен git credential helper и нет GITHUB_TOKEN в env. Анонимный
`git ls-remote`/fetch работает (репозиторий публичный), но для push нужна явная
авторизация через интеграцию Replit (connector `github`).

**Как получить доступ для записи:**
1. `searchIntegrations("github")` → если есть `connection` со статусом `not_added`,
   аккаунт уже авторизован на уровне профиля, нужно только привязать к проекту.
2. `addIntegration(<connection-id>)` (code-side) + `proposeIntegration(<connection-id>)`
   (platform-side binding). БЕЗ proposeIntegration прокси коннекторов не отдаёт токен
   этому Repl (вернёт `items: []`).
3. Токен берётся из прокси в bash (НЕ в code_execution — там `process.env` пуст):
   `curl https://$REPLIT_CONNECTORS_HOSTNAME/api/v2/connection?include_secrets=true&connector_names=github`
   с заголовком `X_REPLIT_TOKEN: repl $REPL_IDENTITY`, поле `items[0].settings.access_token`.
4. Push: `git push --force https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git main:main`.
   Токен в логи не печатать (sed-маскировать); постоянный remote `origin` хранить без токена.

**Why:** дважды до этого задачи "force-push" завершались как MERGED, но GitHub не
обновлялся — причина была в отсутствии привязанного коннектора (токена для записи).
После привязки connector `github` (scope `repo`) push проходит.

**How to apply:** destructive git (force-push, commit) выполнять через фоновую
Project Task; токен доступен и в task-окружении (REPL_IDENTITY + connectors прокси
наследуются). Репозиторий: `Bigjoker1012/sapply-klm`, владелец `Bigjoker1012`.
