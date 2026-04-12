# PilingTrack — Local Access Guide

## Быстрый старт

```powershell
# 1. Запустить port-forward Ingress
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80 --address 127.0.0.1

# 2. (опционально) PostgreSQL для прямого доступа к БД
kubectl port-forward -n pilingtrack-prod svc/postgresql 5432:5432 --address 127.0.0.1

# 3. Grafana уже работает через Docker Compose
#    http://localhost:3010 (admin/admin)
```

## Эндпоинты

| Сервис | URL | Доступ |
|--------|-----|--------|
| **API** | http://localhost:8080 | Через Ingress (требует Host header) |
| **Grafana** | http://localhost:3010 | admin/admin |
| **Prometheus** | http://localhost:9090 | Без auth |
| **PostgreSQL** | localhost:5432 | user: postgres, pass: pilingtrack |
| **Redis** | localhost:6379 | Без auth |

## Примеры запросов

```bash
# Health check
curl http://127.0.0.1:8080/api/health -H "Host: app.pilingtrack.local"

# Readiness
curl http://127.0.0.1:8080/api/ready -H "Host: app.pilingtrack.local"

# Login
curl -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Host: app.pilingtrack.local" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@piling.ru","password":"admin123"}'

# Get crews (требуется auth cookie)
curl http://127.0.0.1:8080/api/crews \
  -H "Host: app.pilingtrack.local" \
  -b "pt-session=YOUR_TOKEN"

# Get sites
curl http://127.0.0.1:8080/api/sites \
  -H "Host: app.pilingtrack.local" \
  -b "pt-session=YOUR_TOKEN"

# Get dictionaries
curl http://127.0.0.1:8080/api/dictionary/all \
  -H "Host: app.pilingtrack.local" \
  -b "pt-session=YOUR_TOKEN"
```

## Учётные данные

| Роль | Email | Пароль |
|------|-------|--------|
| **ADMIN** | admin@piling.ru | admin123 |
| **DISPATCHER** | dispatch@piling.ru | 2222 |
| **OPERATOR** | operator@piling.ru | operator123 |

## Данные в БД

| Сущность | Количество |
|----------|-----------|
| Пользователи | 3 |
| Объекты | 2 |
| Оборудование | 3 |
| Бригады | 1 |
| Марки свай | 5 |
| Типы бурения | 4 |
| Причины простоев | 6 |
| Поля/Кусты/Пикеты | 1/1/3 |

## Скрипты

| Файл | Описание |
|------|----------|
| `scripts/port-forward-api.bat` | Запустить port-forward для API |
| `scripts/port-forward-all.bat` | Запустить все port-forwards |
| `scripts/test-ingress.bat` | Протестировать все эндпоинты |

## Проверка статуса кластера

```bash
kubectl get pods -n pilingtrack-prod
kubectl get ingress -n pilingtrack-prod
kubectl get pods -n ingress-nginx
kubectl logs -l app.kubernetes.io/component=api -n pilingtrack-prod --tail=50
```

## Архитектура доступа

```
Внешний запрос
    ↓
localhost:8080 (port-forward)
    ↓
ingress-nginx-controller (Ingress pod)
    ↓
Host: app.pilingtrack.local → pilingtrack-prod-api:3000 (ClusterIP service)
    ↓
API pod (Next.js standalone)
```
