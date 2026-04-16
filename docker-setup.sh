#!/bin/bash
# ============================================================
# Docker Desktop Quick Start для PilingTrack (MacOS/Linux)
# ============================================================

set -e

echo "🐳 Docker Desktop Setup для PilingTrack"

# Проверка Docker
echo "✓ Проверка Docker..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Скачайте Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo "✅ Docker установлен"

# Проверка Docker Compose
echo "✓ Проверка Docker Compose..."
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose не установлен"
    exit 1
fi
echo "✅ Docker Compose установлен"

# Создать .env если не существует
if [ ! -f ".env" ]; then
    echo ""
    echo "📝 Создаю .env файл..."
    
    # Генерируем SESSION_SECRET
    SESSION_SECRET=$(openssl rand -base64 32 | tr -d '\n')
    
    cat > .env << EOF
# Docker Configuration
DATABASE_PROVIDER="postgres"
DATABASE_URL_POSTGRES="postgresql://piling:postgres123@postgres:5432/pilingtrack?schema=public"
POSTGRES_DB="pilingtrack"
POSTGRES_USER="piling"
POSTGRES_PASSWORD="postgres123"
SESSION_SECRET="$SESSION_SECRET"
DATABASE_LOG_QUERIES="false"
MULTI_TENANT_MODE="false"
DEFAULT_TENANT_ID="default"
REDIS_URL="redis://redis:6379"
ENCRYPTION_KEY="00000000000000000000000000000000"
NODE_ENV="production"
EOF
    
    echo "✅ .env создан"
else
    echo "✅ .env уже существует"
fi

# Проверить volumse
echo ""
echo "✓ Проверка Docker volumes..."
docker volume ls | grep -q postgres_data && echo "✅ postgres_data существует" || (
    echo "📦 Создаю postgres_data..."
    docker volume create postgres_data
)

docker volume ls | grep -q redis_data && echo "✅ redis_data существует" || (
    echo "📦 Создаю redis_data..."
    docker volume create redis_data
)

# Финальные инструкции
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║       Docker Desktop готов к запуску!                  ║"
echo "╚════════════════════════════════════════════════════════╝"

echo ""
echo "📋 Запустить приложение:"
echo ""
echo "  docker compose up -d"
echo ""
echo "📊 Просмотр логов:"
echo ""
echo "  docker compose logs -f app"
echo ""
echo "🌐 Доступ к приложению:"
echo ""
echo "  App:     http://localhost:3000"
echo "  pgAdmin: http://localhost:5050 (admin@pilingtrack.local / admin)"
echo ""
echo "✅ Setup завершен!"
