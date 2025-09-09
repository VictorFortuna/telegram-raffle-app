const crypto = require('crypto');

const errorHandler = (error, req, res, next) => {
  const errorId = crypto.randomUUID();
  
  // Логируем ошибку с уникальным ID
  console.error(`[${errorId}] ${error.message}`, {
    stack: error.stack,
    user: req.user?.telegram_id,
    url: req.url,
    method: req.method,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  // Определяем тип ошибки и статус код
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Произошла внутренняя ошибка сервера';

  // Обработка специфичных ошибок
  switch (error.code || error.message) {
    case 'VALIDATION_ERROR':
      statusCode = 400;
      errorCode = 'VALIDATION_ERROR';
      message = error.message;
      break;

    case 'USER_NOT_FOUND':
      statusCode = 404;
      errorCode = 'USER_NOT_FOUND';
      message = 'Пользователь не найден';
      break;

    case 'RAFFLE_NOT_FOUND':
      statusCode = 404;
      errorCode = 'RAFFLE_NOT_FOUND';
      message = 'Лотерея не найдена';
      break;

    case 'RAFFLE_NOT_ACTIVE':
      statusCode = 400;
      errorCode = 'RAFFLE_NOT_ACTIVE';
      message = 'Лотерея не активна';
      break;

    case 'ALREADY_PARTICIPATED':
      statusCode = 400;
      errorCode = 'ALREADY_PARTICIPATED';
      message = 'Вы уже участвуете в этой лотерее';
      break;

    case 'RAFFLE_FULL':
      statusCode = 400;
      errorCode = 'RAFFLE_FULL';
      message = 'Лотерея уже заполнена';
      break;

    case 'INSUFFICIENT_BALANCE':
      statusCode = 400;
      errorCode = 'INSUFFICIENT_BALANCE';
      message = 'Недостаточно Telegram Stars';
      break;

    case 'TRANSACTION_FAILED':
      statusCode = 400;
      errorCode = 'TRANSACTION_FAILED';
      message = 'Транзакция не удалась';
      break;

    case 'UNAUTHORIZED':
      statusCode = 401;
      errorCode = 'UNAUTHORIZED';
      message = 'Необходима авторизация';
      break;

    case 'FORBIDDEN':
      statusCode = 403;
      errorCode = 'FORBIDDEN';
      message = 'Доступ запрещен';
      break;

    case 'RATE_LIMIT_EXCEEDED':
      statusCode = 429;
      errorCode = 'RATE_LIMIT_EXCEEDED';
      message = 'Превышен лимит запросов';
      break;

    case 'SETTINGS_NOT_FOUND':
      statusCode = 404;
      errorCode = 'SETTINGS_NOT_FOUND';
      message = 'Настройки не найдены';
      break;

    case 'INVALID_TRANSACTION':
      statusCode = 400;
      errorCode = 'INVALID_TRANSACTION';
      message = 'Недопустимая транзакция';
      break;

    default:
      // Проверяем PostgreSQL ошибки
      if (error.code && error.code.startsWith('23')) {
        // Constraint violation
        statusCode = 400;
        errorCode = 'DATABASE_CONSTRAINT_ERROR';
        message = 'Нарушение ограничений базы данных';
      } else if (error.code === 'ECONNREFUSED') {
        statusCode = 503;
        errorCode = 'SERVICE_UNAVAILABLE';
        message = 'Сервис временно недоступен';
      }
  }

  // Возвращаем ответ клиенту
  res.status(statusCode).json({
    error: errorCode,
    message: message,
    errorId: errorId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      originalError: error.message
    })
  });

  // Уведомляем администраторов о критических ошибках
  if (statusCode >= 500) {
    notifyAdminsOfError(error, errorId, req);
  }
};

async function notifyAdminsOfError(error, errorId, req) {
  try {
    const telegramService = require('../services/telegramService');
    
    const errorInfo = {
      errorId,
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      user: req.user?.telegram_id,
      timestamp: new Date().toISOString()
    };

    await telegramService.notifyAdmins(
      `🚨 Critical Error [${errorId}]\n\n${error.message}`,
      errorInfo
    );
  } catch (notificationError) {
    console.error('Failed to notify admins of error:', notificationError);
  }
}

// Обработчик необработанных отклонений промисов
process.on('unhandledRejection', (reason, promise) => {
  const errorId = crypto.randomUUID();
  console.error(`[${errorId}] Unhandled Rejection:`, reason);
  
  // Не завершаем процесс, просто логируем
  // В production среде можно добавить более сложную логику
});

// Обработчик необработанных исключений
process.on('uncaughtException', (error) => {
  const errorId = crypto.randomUUID();
  console.error(`[${errorId}] Uncaught Exception:`, error);
  
  // В критическом случае завершаем процесс
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

module.exports = errorHandler;