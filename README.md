# 🎲 Telegram Raffle Stars

Система лотерей в Telegram Mini App с интеграцией Telegram Stars.

## ✨ Возможности

- 🎮 **Простой интерфейс**: Одна большая кнопка для участия в лотерее
- ⭐ **Telegram Stars**: Интеграция с системой платежей Telegram
- 🔄 **Реальное время**: WebSocket уведомления о новых ставках и результатах
- 🏆 **Честная игра**: Криптографически стойкий алгоритм выбора победителя
- 👥 **Масштабируемость**: Поддержка тысяч одновременных пользователей
- 🛠️ **Админ панель**: Полное управление настройками и мониторинг

## 🏗️ Архитектура

### Backend
- **Node.js + Express**: Основной сервер приложения
- **PostgreSQL**: База данных для хранения пользователей и лотерей
- **Socket.IO**: WebSocket соединения для реального времени
- **Telegram Bot API**: Интеграция с Telegram для обработки платежей

### Frontend
- **Telegram Mini App**: Нативный интерфейс в Telegram
- **Vanilla JavaScript**: Быстрый и легковесный клиент
- **Bootstrap**: Админ панель с современным дизайном
- **Real-time Updates**: Мгновенные обновления через WebSocket

## 🚀 Быстрый старт

### Требования
- Node.js 18+
- PostgreSQL 13+
- Redis (опционально, для production)
- Telegram Bot Token

### Установка

1. **Клонирование репозитория**
```bash
git clone <repository-url>
cd telegram-raffle-stars
```

2. **Установка зависимостей**
```bash
npm install
```

3. **Настройка базы данных**
```bash
# Создайте базу данных PostgreSQL
createdb telegram_raffle

# Запустите скрипт настройки
npm run setup-db
```

4. **Конфигурация переменных окружения**
```bash
# Скопируйте пример конфигурации
cp .env.example .env

# Отредактируйте файл .env с вашими настройками
```

5. **Запуск приложения**
```bash
# Разработка
npm run dev

# Production
npm start
```

## ⚙️ Конфигурация

### Переменные окружения

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/webhook/telegram

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_encryption_key

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=bcrypt_hash

# Server
PORT=3000
NODE_ENV=production
```

### Настройка Telegram Bot

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Получите токен и добавьте в переменные окружения
3. Настройте Menu Button на ваш домен
4. Включите Telegram Stars в настройках бота

## 📦 Развертывание на Railway

1. **Подготовка**
```bash
# Установите Railway CLI
npm install -g @railway/cli

# Войдите в аккаунт
railway login
```

2. **Инициализация проекта**
```bash
railway init
```

3. **Добавление базы данных**
```bash
railway add postgresql
```

4. **Настройка переменных окружения**
```bash
railway variables set TELEGRAM_BOT_TOKEN=your_token
railway variables set JWT_SECRET=your_secret
railway variables set ADMIN_PASSWORD_HASH=your_hash
# ... другие переменные
```

5. **Развертывание**
```bash
railway up
```

6. **Настройка базы данных**
```bash
railway run npm run setup-db
```

## 🎮 Использование

### Для пользователей
1. Откройте Mini App через Telegram бота
2. Нажмите большую кнопку "СТАВКА" для участия
3. Оплатите ставку через Telegram Stars
4. Дождитесь завершения лотереи
5. Получите приз, если выиграли!

### Для администраторов
1. Перейдите на `/admin` 
2. Войдите с админскими учетными данными
3. Управляйте настройками лотереи
4. Мониторьте активность пользователей
5. Просматривайте логи и статистику

## 🛠️ API Документация

### Основные endpoints

```bash
# Аутентификация
POST /api/auth/telegram     # Вход через Telegram
GET  /api/auth/verify       # Проверка токена

# Пользователи
GET  /api/user/profile      # Профиль пользователя
GET  /api/user/balance      # Баланс Telegram Stars
GET  /api/user/stats        # Статистика пользователя

# Лотереи
GET  /api/raffle/current    # Текущая лотерея
POST /api/raffle/bid        # Сделать ставку
GET  /api/raffle/history    # История лотерей

# Статистика
GET  /api/stats/global      # Глобальная статистика
GET  /api/stats/raffles     # Статистика лотерей

# Админ панель
POST /api/admin/login       # Вход админа
GET  /api/admin/raffles     # Управление лотереями
PUT  /api/admin/settings    # Настройки системы
```

## 🧪 Тестирование

```bash
# Запуск всех тестов
npm test

# Тестирование с покрытием
npm run test:coverage

# Линтинг кода
npm run lint

# Проверка типов
npm run typecheck
```

## 🔧 Разработка

### Структура проекта
```
telegram-raffle-stars/
├── src/                    # Серверный код
│   ├── routes/            # API маршруты
│   ├── models/            # Модели данных
│   ├── services/          # Бизнес-логика
│   ├── middleware/        # Промежуточное ПО
│   └── utils/             # Утилиты
├── public/                # Статические файлы
│   ├── css/               # Стили
│   ├── js/                # Клиентский JavaScript
│   ├── index.html         # Mini App интерфейс
│   └── admin.html         # Админ панель
├── scripts/               # Скрипты настройки
├── tests/                 # Тесты
└── server.js              # Точка входа
```

### Команды разработки
```bash
npm run dev          # Запуск с автоперезагрузкой
npm run setup-db     # Настройка базы данных
npm run seed-db      # Наполнение тестовыми данными
npm run lint         # Проверка кода
npm run build        # Сборка для production
```

## 🔐 Безопасность

- **JWT токены** для аутентификации пользователей
- **Rate limiting** для предотвращения спама
- **Валидация входных данных** на всех уровнях
- **Шифрование чувствительных данных**
- **Аудит логи** всех важных действий
- **HTTPS** обязательно в production

## 📊 Мониторинг

### Метрики
- Количество активных пользователей
- Статистика лотерей и выигрышей
- Производительность API
- Использование ресурсов сервера

### Логирование
- Все действия пользователей
- Ошибки и исключения
- Изменения настроек
- WebSocket соединения

## 🤝 Поддержка

Если у вас возникли вопросы или проблемы:

1. Проверьте [документацию](docs/)
2. Посмотрите [часто задаваемые вопросы](docs/FAQ.md)
3. Создайте [issue](issues/) с описанием проблемы

## 📝 Лицензия

MIT License - смотрите [LICENSE](LICENSE) файл для деталей.

## 🙏 Благодарности

- [Telegram](https://telegram.org) за отличную платформу
- [Railway](https://railway.app) за удобный хостинг
- [Node.js](https://nodejs.org) сообщество за экосистему

---

Сделано с ❤️ для Telegram сообщества