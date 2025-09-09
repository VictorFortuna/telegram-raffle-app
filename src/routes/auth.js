const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const telegramService = require('../services/telegramService');

const router = express.Router();

// Авторизация через Telegram Mini App
router.post('/telegram', async (req, res, next) => {
  try {
    const { initData, user } = req.body;

    // Валидация обязательных полей
    if (!user || !user.id) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Данные пользователя обязательны'
      });
    }

    // Проверяем подлинность данных от Telegram Mini App
    const isValidData = telegramService.validateWebAppData(initData);
    if (!isValidData && process.env.NODE_ENV === 'production') {
      return res.status(401).json({
        error: 'INVALID_TELEGRAM_DATA',
        message: 'Недопустимые данные от Telegram'
      });
    }

    // Создаем или обновляем пользователя
    const userData = {
      telegram_id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      language_code: user.language_code || 'ru'
    };

    const dbUser = await User.create(userData);

    // Проверяем баланс Telegram Stars
    try {
      const starsBalance = await telegramService.checkUserStarsBalance(user.id);
      if (starsBalance && starsBalance.balance !== undefined) {
        await dbUser.updateStarsBalance(starsBalance.balance);
      }
    } catch (balanceError) {
      console.warn('Could not check stars balance:', balanceError);
      // Продолжаем без обновления баланса
    }

    // Создаем JWT токен
    const token = jwt.sign(
      { 
        telegram_id: dbUser.telegram_id,
        username: dbUser.username,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Логируем успешную авторизацию
    console.log(`✅ User authenticated: ${dbUser.telegram_id} (${dbUser.username})`);

    res.json({
      success: true,
      message: 'Авторизация успешна',
      token: token,
      user: dbUser.getPublicStats(),
      expires_in: 7 * 24 * 60 * 60 // 7 дней в секундах
    });

  } catch (error) {
    next(error);
  }
});

// Обновление информации о пользователе
router.put('/refresh', authenticateToken, async (req, res, next) => {
  try {
    const { user: userData } = req.body;
    
    if (!userData) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Данные пользователя обязательны'
      });
    }

    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    // Обновляем информацию пользователя
    const updatedUserData = {
      telegram_id: user.telegram_id,
      username: userData.username || user.username,
      first_name: userData.first_name || user.first_name,
      last_name: userData.last_name || user.last_name,
      language_code: userData.language_code || user.language_code
    };

    const updatedUser = await User.create(updatedUserData);

    // Обновляем баланс звезд
    try {
      const starsBalance = await telegramService.checkUserStarsBalance(user.telegram_id);
      if (starsBalance && starsBalance.balance !== undefined) {
        await updatedUser.updateStarsBalance(starsBalance.balance);
      }
    } catch (balanceError) {
      console.warn('Could not update stars balance:', balanceError);
    }

    res.json({
      success: true,
      message: 'Информация обновлена',
      user: updatedUser.getPublicStats()
    });

  } catch (error) {
    next(error);
  }
});

// Выход из системы
router.post('/logout', authenticateToken, async (req, res, next) => {
  try {
    // В данной реализации мы используем stateless JWT токены
    // Поэтому просто возвращаем успешный ответ
    // В production можно реализовать blacklist токенов
    
    res.json({
      success: true,
      message: 'Выход выполнен успешно'
    });

  } catch (error) {
    next(error);
  }
});

// Проверка валидности токена
router.get('/verify', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findByTelegramId(req.user.telegram_id);
    
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    await user.updateActivity();

    res.json({
      success: true,
      user: user.getPublicStats(),
      token_valid: true,
      expires_at: new Date(req.user.exp * 1000)
    });

  } catch (error) {
    next(error);
  }
});

// Middleware для проверки JWT токена
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Токен доступа отсутствует'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      let message = 'Недопустимый токен';
      
      if (err.name === 'TokenExpiredError') {
        message = 'Токен истек';
      } else if (err.name === 'JsonWebTokenError') {
        message = 'Неверный формат токена';
      }

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: message
      });
    }

    req.user = user;
    next();
  });
}

module.exports = {
  router,
  authenticateToken
};