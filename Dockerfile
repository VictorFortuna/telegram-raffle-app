# Telegram Raffle Stars - Production Dockerfile
FROM node:18-alpine

# Установка зависимостей системы
RUN apk add --no-cache postgresql-client

# Создание рабочей директории
WORKDIR /app

# Копирование файлов зависимостей
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production && npm cache clean --force

# Копирование исходного кода
COPY . .

# Создание пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S telegram -u 1001 && \
    chown -R telegram:nodejs /app

# Переключение на пользователя
USER telegram

# Открытие порта
EXPOSE 3000

# Проверка здоровья контейнера
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Запуск приложения
CMD ["node", "server.js"]