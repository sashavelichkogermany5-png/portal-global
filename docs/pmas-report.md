# P-M-A-S — отчёт

Сгенерировано: 2026-03-05T20:07:52.124Z

## 1. Auth storm /api/auth/me

Problem: Снизить шторм запросов /api/auth/me без ломки логики auth

Fitness:
- F1: p95 latency (ms)
- F2: rate-limit hits (count/час)
- F3: повторные запросы от одного клиента (count/мин)

Varianten:
- A: ничего не менять, только кеш TTL
- B: single-flight на сервере
- C: single-flight + micro-cache на сервере
- D: C + client backoff + min-interval

Fakten-check:
- У /api/auth/me уже есть кеш по userId и inFlight
- UI делает частые запросы auth/me при старте
- Есть rate limit на auth/me

Stress-test:
- S1: F1=6 F2=7 F3=6
- S2: F1=5 F2=5 F3=5
- S3: F1=3 F2=3 F3=3

Selektion: победитель D, второй C
Kreuzung: D + усилить наблюдаемость (storm log) и порог
Result: Реализовать D: серверный shield + клиентский backoff

## 2. Autopilot enable/tick и S3 безопасность

Problem: Снизить риск неправильных действий автопилота

Fitness:
- F1: число ошибок доступа (count)
- F2: риск tenant-утечки (yes/no)
- F3: воспроизводимость запуска (1-10)

Varianten:
- A: оставить как есть
- B: убрать service-token fallback
- C: добавить строгий аудит и idempotency ключи
- D: C + rate limits + явные allowlist действий

Fakten-check:
- Enable/tick требуют admin или service-token
- Запуски логируются в agent_messages
- TenantId должен быть только из auth/session

Stress-test:
- S1: F1=7 F2=8 F3=7
- S2: F1=6 F2=8 F3=6
- S3: F1=5 F2=9 F3=6

Selektion: победитель D, второй C
Kreuzung: D + минимизировать изменения интерфейса
Result: Усилить безопасность: аудит + идемпотентность + allowlist

## 3. Upload 500 в /api/upload

Problem: Устранить 500 в upload и дать понятный UX

Fitness:
- F1: % успешных загрузок
- F2: среднее время загрузки
- F3: число ошибок 5xx

Varianten:
- A: только исправить storage path
- B: править auth flow + storage
- C: добавить детальные ошибки + retries
- D: B + C + ограничить типы/размеры на клиенте

Fakten-check:
- Upload использует Next.js route и проверяет /api/auth/me
- В smoke было 500 по upload
- Файлы сохраняются в web-next/public/uploads

Stress-test:
- S1: F1=8 F2=7 F3=8
- S2: F1=7 F2=6 F3=7
- S3: F1=6 F2=5 F3=6

Selektion: победитель D, второй B
Kreuzung: D + минимизировать UI шум
Result: Починить auth+storage и добавить ясный error UX

## 4. Analytics quality/noise

Problem: Снизить шум в аналитике без потери полезных данных

Fitness:
- F1: доля noise lines
- F2: покрытие временного окна
- F3: скорость ответа summary

Varianten:
- A: оставить текущие фильтры
- B: расширить noise paths
- C: усилить dedup window
- D: B + C + debug режим

Fakten-check:
- Есть dedup/filters в ANALYTICS_*
- Шум портит summary
- Debug режим уже предусмотрен

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй B
Kreuzung: D + валидация noise paths
Result: Расширить шумовые пути и dedup, оставить debug

## 5. Stats/Usage cache

Problem: Снизить latency stats/usage endpoints

Fitness:
- F1: combined median (ms)
- F2: combined p95 (ms)
- F3: usage median (ms)

Varianten:
- A: STATS=250, USAGE=2000
- B: STATS=5000, USAGE=2000
- C: STATS=100, USAGE=250
- D: STATS=5000, USAGE=5000

Fakten-check:
- GA-погоны есть в ops/ga/results-stats.json
- Лучший combinedMedian у D
- statsP95 у B лучше

Stress-test:
- S1: F1=8 F2=7 F3=8
- S2: F1=7 F2=6 F3=7
- S3: F1=6 F2=5 F3=6

Selektion: победитель D, второй B
Kreuzung: D + проверка statsP95 на B
Result: Выбрать D, перепроверить statsP95

## 6. Auth login/register стабильность

Problem: Снизить ошибки входа и регистрации без ломки UX

Fitness:
- F1: % успешных входов
- F2: p95 latency login/register
- F3: число 4xx/5xx

Varianten:
- A: только увеличить лимиты
- B: улучшить валидацию + ясные ошибки
- C: B + ограничить повторные попытки
- D: C + наблюдаемость (лог меток отказа)

Fakten-check:
- Есть rate limit на auth
- Ответы уже возвращают ok/error
- Сессии создаются в SQLite

Stress-test:
- S1: F1=8 F2=7 F3=7
- S2: F1=7 F2=6 F3=6
- S3: F1=6 F2=5 F3=6

Selektion: победитель D, второй C
Kreuzung: D + минимизировать число проверок
Result: Валидация + лимиты + лог причин отказа

## 7. Tenant switch

Problem: Снизить ошибки переключения тенанта

Fitness:
- F1: % успешных переключений
- F2: число 403/404
- F3: время до активного тенанта

Varianten:
- A: оставить как есть
- B: проверять membership на каждом запросе
- C: B + кеш активного тенанта
- D: C + явная синхронизация на клиенте

Fakten-check:
- TenantId должен быть из auth/session
- Есть endpoint активного тенанта
- UI хранит tenantId локально

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=5 F3=5

Selektion: победитель D, второй C
Kreuzung: D + строгость в server-side проверке
Result: Держать tenant в sync и проверять членство

## 8. Tenant invite/approve

Problem: Снизить ошибки приглашений и одобрений

Fitness:
- F1: % успешных приглашений
- F2: число конфликтов статуса
- F3: время завершения

Varianten:
- A: оставить как есть
- B: идемпотентность по email+tenant
- C: B + явная проверка ролей
- D: C + аудит/лог событий

Fakten-check:
- Есть endpoints для приглашений и одобрений
- Роли управляют доступом
- Статусы участников хранятся в БД

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй C
Kreuzung: D + минимальные изменения API
Result: Идемпотентность + строгие роли + аудит

## 9. Agent dispatch/actions

Problem: Снизить ошибки в dispatch и выполнении actions

Fitness:
- F1: % успешных dispatch
- F2: % успешных actions execute
- F3: число ошибок прав доступа

Varianten:
- A: только логирование
- B: строгая валидация event_type
- C: B + дедупликация по correlationId
- D: C + явная allowlist action types

Fakten-check:
- Dispatch создает agent_messages/actions
- Action execute зависит от ролей
- correlationId используется как thread

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй C
Kreuzung: D + минимизировать влияние на UX
Result: Валидация + дедуп + allowlist

## 10. Autopilot offers/leads

Problem: Снизить шум и ошибки при генерации офферов/лидов

Fitness:
- F1: % валидных записей
- F2: число дубликатов
- F3: время цикла

Varianten:
- A: оставить как есть
- B: валидировать входные данные
- C: B + дедуп по ключам
- D: C + лимит действий за цикл

Fakten-check:
- Autopilot пишет в agent_messages
- Есть endpoints offers/leads
- Цикл может повторяться по расписанию

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй C
Kreuzung: D + минимизировать ограничения при ручном запуске
Result: Валидация + дедуп + лимиты на цикл

## 11. Autopilot metrics

Problem: Снизить задержки и ошибки метрик автопилота

Fitness:
- F1: p95 latency metrics
- F2: % успешных ответов
- F3: точность данных

Varianten:
- A: без кеша
- B: короткий кеш
- C: кеш + лимит размера
- D: C + фоновое обновление

Fakten-check:
- Есть endpoint /api/autopilot/metrics
- Данные зависят от последних циклов
- Ошибки метрик влияют на UI

Stress-test:
- S1: F1=7 F2=7 F3=6
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй C
Kreuzung: D + ограничить TTL кеша
Result: Кеш + фоновые обновления

## 12. Analytics summary performance

Problem: Ускорить /api/admin/analytics/summary

Fitness:
- F1: p95 latency
- F2: объем обрабатываемых строк
- F3: точность summary

Varianten:
- A: без оптимизаций
- B: уменьшить окно
- C: чанки + лимит строк
- D: C + кэш результата

Fakten-check:
- Summary читает analytics.ndjson
- Есть параметры окна и лимиты
- Debug режим уже есть

Stress-test:
- S1: F1=7 F2=7 F3=6
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=6 F3=5

Selektion: победитель D, второй C
Kreuzung: D + оставить debug доступным
Result: Чанки + лимиты + кеш

## 13. Health endpoint

Problem: Снизить latency /api/health

Fitness:
- F1: median latency
- F2: p95 latency
- F3: db latency

Varianten:
- A: HEALTH_CACHE_TTL_MS=0
- B: HEALTH_CACHE_TTL_MS=50
- C: HEALTH_CACHE_TTL_MS=250
- D: HEALTH_CACHE_TTL_MS=2000

Fakten-check:
- Есть health cache и окна
- GA-погоны есть для health
- db latency учитывается

Stress-test:
- S1: F1=8 F2=7 F3=8
- S2: F1=7 F2=6 F3=7
- S3: F1=6 F2=5 F3=6

Selektion: победитель D, второй B
Kreuzung: D + проверка p95 на B
Result: Выбрать 2000ms, контролировать p95

## 14. Projects/Orders export

Problem: Снизить ошибки и таймауты экспорта

Fitness:
- F1: % успешных экспортов
- F2: среднее время экспорта
- F3: число таймаутов

Varianten:
- A: без ограничений
- B: лимит размера + пагинация
- C: B + фоновые задания
- D: C + ретраи с backoff

Fakten-check:
- Есть endpoints /api/projects/export и /api/orders/export
- Экспорт может быть тяжёлым
- Таймауты ухудшают UX

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=5 F3=6

Selektion: победитель D, второй C
Kreuzung: D + минимизировать фоновые зависимости
Result: Пагинация + фоновые задания + ретраи

## 15. Feedback flow

Problem: Снизить потери feedback и ошибки отправки

Fitness:
- F1: % успешных feedback
- F2: число 4xx/5xx
- F3: время ответа

Varianten:
- A: оставить как есть
- B: улучшить валидацию
- C: B + лимиты
- D: C + логирование отказов

Fakten-check:
- Есть endpoints /api/feedback и /api/feedback/me
- Есть лимиты на feedback
- Ошибки блокируют сбор обратной связи

Stress-test:
- S1: F1=7 F2=7 F3=7
- S2: F1=6 F2=6 F3=6
- S3: F1=5 F2=5 F3=5

Selektion: победитель D, второй C
Kreuzung: D + простота UX
Result: Валидация + лимиты + логирование
