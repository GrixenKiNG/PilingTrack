# ============================================================
# Docker Desktop Setup для PilingTrack
# ============================================================
# Запуск: .\docker-setup.ps1

Write-Host "🐳 Docker Desktop Setup для PilingTrack" -ForegroundColor Cyan

# Проверка Docker
Write-Host "`n✓ Проверка Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
    Write-Host "✅ Docker установлен" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker не установлен. Установите Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}

# Проверка Docker Compose
Write-Host "✓ Проверка Docker Compose..." -ForegroundColor Yellow
try {
    docker compose version | Out-Null
    Write-Host "✅ Docker Compose установлен" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose не установлен" -ForegroundColor Red
    exit 1
}

# Генерируем SESSION_SECRET если не существует
$envFile = ".env"
if (!(Test-Path $envFile)) {
    Write-Host "`n📝 Создаю .env файл..." -ForegroundColor Yellow
    
    # Генерируем случайный SESSION_SECRET (32+ символа)
    $sessionSecret = -join ((0..63) | ForEach-Object { "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(Get-Random -Maximum 62)] })
    
    $envContent = @"
# Docker Configuration
DATABASE_PROVIDER="postgres"
DATABASE_URL_POSTGRES="postgresql://piling:postgres123@postgres:5432/pilingtrack?schema=public"
POSTGRES_DB="pilingtrack"
POSTGRES_USER="piling"
POSTGRES_PASSWORD="postgres123"
SESSION_SECRET="$sessionSecret"
DATABASE_LOG_QUERIES="false"
MULTI_TENANT_MODE="false"
DEFAULT_TENANT_ID="default"
REDIS_URL="redis://redis:6379"
ENCRYPTION_KEY="00000000000000000000000000000000"
SENTRY_AUTH_TOKEN=""
NODE_ENV="production"
"@
    
    $envContent | Out-File -FilePath $envFile -Encoding UTF8
    Write-Host "✅ .env создан" -ForegroundColor Green
} else {
    Write-Host "✅ .env уже существует" -ForegroundColor Green
}

# Проверяем объем данных
Write-Host "`n✓ Проверка Docker volumes..." -ForegroundColor Yellow
$volumeExists = docker volume ls | Select-String "postgres_data"
if (!$volumeExists) {
    Write-Host "📦 Создание volumes..."
    docker volume create postgres_data
    docker volume create redis_data
    Write-Host "✅ Volumes созданы" -ForegroundColor Green
} else {
    Write-Host "✅ Volumes уже существуют" -ForegroundColor Green
}

# Финальные инструкции
Write-Host "`n" -ForegroundColor Cyan
Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       Docker Desktop готов к запуску!                  ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`n📋 Команды для запуска:" -ForegroundColor Yellow
Write-Host "
  # Запустить все сервисы
  docker compose up -d

  # Просмотр логов приложения
  docker compose logs -f app

  # Остановить все сервисы
  docker compose down

  # Перестроить образ
  docker compose up -d --build

  # Удалить ВСЕ данные и начать заново
  docker compose down -v
" -ForegroundColor White

Write-Host "`n🌐 Порты приложения:" -ForegroundColor Yellow
Write-Host "
  App:      http://localhost:3000
  pgAdmin:  http://localhost:5050 (admin@pilingtrack.local / password)
  Redis:    localhost:6379
  Postgres: localhost:5432
" -ForegroundColor White

Write-Host "`n💡 Уменьшить использование памяти Docker Desktop:" -ForegroundColor Yellow
Write-Host "
  Откройте: Docker Desktop > Settings > Resources
  - Memory: 4GB (вместо 8GB)
  - CPU: 4 cores (вместо 8)
  - Swap: 1GB
" -ForegroundColor White

Write-Host "`n✅ Setup завершен!`n" -ForegroundColor Green
