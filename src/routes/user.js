const express = require('express');
const { authenticateToken } = require('./auth');
const User = require('../models/User');
const telegramService = require('../services/telegramService');
const socketService = require('../services/socketService');

const router = express.Router();

// Применяем аутентификацию ко всем маршрутам пользователя
router.use(authenticateToken);

// Получение профиля пользователя
router.get('/profile', async (req, res, next) => {
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
      user: user.getFullProfile()
    });

  } catch (error) {
    next(error);
  }
});

// Обновление профиля
router.put('/profile', async (req, res, next) => {
  try {
    const { first_name, last_name, username, language_code } = req.body;

    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    // Обновляем данные пользователя
    const updatedUserData = {
      telegram_id: user.telegram_id,
      username: username || user.username,
      first_name: first_name || user.first_name,
      last_name: last_name || user.last_name,
      language_code: language_code || user.language_code
    };

    const updatedUser = await User.create(updatedUserData);

    res.json({
      success: true,
      message: 'Профиль обновлен',
      user: updatedUser.getFullProfile()
    });

  } catch (error) {
    next(error);
  }
});

// Проверка баланса Telegram Stars
router.get('/balance', async (req, res, next) => {
  try {
    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    try {
      // Получаем актуальный баланс от Telegram
      const starsBalance = await telegramService.checkUserStarsBalance(req.user.telegram_id);
      
      if (starsBalance && starsBalance.balance !== undefined) {
        // Обновляем баланс в базе данных
        await user.updateStarsBalance(starsBalance.balance);
        
        res.json({
          success: true,
          balance: starsBalance.balance,
          last_updated: starsBalance.last_updated,
          cached_balance: user.stars_balance
        });
      } else {
        // Возвращаем кешированный баланс
        res.json({
          success: true,
          balance: user.stars_balance,
          last_updated: user.last_balance_check,
          cached: true,
          message: 'Возвращен кешированный баланс'
        });
      }

    } catch (balanceError) {
      console.error('Error checking stars balance:', balanceError);
      
      // Возвращаем кешированный баланс при ошибке
      res.json({
        success: true,
        balance: user.stars_balance,
        last_updated: user.last_balance_check,
        cached: true,
        warning: 'Не удалось получить актуальный баланс'
      });
    }

  } catch (error) {
    next(error);
  }
});

// Получение статистики пользователя
router.get('/stats', async (req, res, next) => {
  try {
    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    // Получаем дополнительную статистику
    const db = require('../services/databaseService');
    
    // История участия в лотереях
    const participationHistory = await db.query(`
      SELECT 
        r.id as raffle_id,
        r.status,
        r.total_prize,
        r.winner_telegram_id,
        b.amount as bid_amount,
        b.placed_at,
        r.completed_at,
        CASE WHEN r.winner_telegram_id = $1 THEN r.winner_prize ELSE 0 END as won_amount
      FROM bids b
      JOIN raffles r ON b.raffle_id = r.id
      WHERE b.user_telegram_id = $1
      ORDER BY b.placed_at DESC
      LIMIT 20
    `, [req.user.telegram_id]);

    // Статистика побед
    const winStats = await db.query(`
      SELECT 
        COUNT(*) as total_wins,
        SUM(winner_prize) as total_won,
        AVG(winner_prize) as avg_win_amount
      FROM raffles 
      WHERE winner_telegram_id = $1 AND status = 'completed'
    `, [req.user.telegram_id]);

    await user.updateActivity();

    const stats = {
      ...user.getPublicStats(),
      participation_history: participationHistory.rows,
      win_statistics: winStats.rows[0],
      win_rate: user.total_bids > 0 
        ? ((parseInt(winStats.rows[0].total_wins) || 0) / user.total_bids * 100).toFixed(2)
        : 0
    };

    res.json({
      success: true,
      stats: stats
    });

  } catch (error) {
    next(error);
  }
});

// Получение истории транзакций пользователя
router.get('/transactions', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    
    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    const db = require('../services/databaseService');
    
    let baseQuery = `
      SELECT 
        st.*,
        r.id as raffle_id,
        r.status as raffle_status
      FROM star_transactions st
      LEFT JOIN raffles r ON st.raffle_id = r.id
      WHERE st.telegram_id = $1
    `;
    
    const params = [req.user.telegram_id];

    // Фильтр по типу транзакции
    if (type && ['bid', 'prize', 'refund'].includes(type)) {
      baseQuery += ` AND st.transaction_type = $${params.length + 1}`;
      params.push(type);
    }

    baseQuery += ' ORDER BY st.created_at DESC';

    const result = await db.paginate(baseQuery, params, parseInt(page), parseInt(limit));

    res.json({
      success: true,
      transactions: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

// Получение топ победителей (публичная информация)
router.get('/top-winners', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    
    const topWinners = await User.getTopWinners(parseInt(limit));

    // Возвращаем только публичную информацию
    const publicWinners = topWinners.map(winner => ({
      username: winner.username || 'Anonymous',
      first_name: winner.first_name || 'User',
      total_winnings: winner.total_winnings,
      total_bids: winner.total_bids
    }));

    res.json({
      success: true,
      winners: publicWinners
    });

  } catch (error) {
    next(error);
  }
});

// Уведомления пользователя (для управления подписками)
router.get('/notifications/settings', async (req, res, next) => {
  try {
    // В будущем здесь можно реализовать настройки уведомлений
    res.json({
      success: true,
      settings: {
        raffle_completed: true,
        new_raffle: true,
        you_won: true,
        refund: true,
        system_messages: true
      }
    });

  } catch (error) {
    next(error);
  }
});

// Обновление настроек уведомлений
router.put('/notifications/settings', async (req, res, next) => {
  try {
    const { settings } = req.body;

    // В будущем здесь можно реализовать сохранение настроек
    console.log(`Notification settings update for user ${req.user.telegram_id}:`, settings);

    res.json({
      success: true,
      message: 'Настройки уведомлений обновлены',
      settings: settings
    });

  } catch (error) {
    next(error);
  }
});

// Удаление аккаунта (GDPR compliance)
router.delete('/account', async (req, res, next) => {
  try {
    const { confirmation } = req.body;

    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Требуется подтверждение удаления аккаунта'
      });
    }

    const db = require('../services/databaseService');
    
    await db.transaction(async (client) => {
      // Проверяем, нет ли активных ставок
      const activeBids = await client.query(
        'SELECT COUNT(*) as count FROM bids b JOIN raffles r ON b.raffle_id = r.id WHERE b.user_telegram_id = $1 AND r.status = $2',
        [req.user.telegram_id, 'active']
      );

      if (parseInt(activeBids.rows[0].count) > 0) {
        throw new Error('Невозможно удалить аккаунт с активными ставками');
      }

      // Анонимизируем данные пользователя вместо полного удаления
      // (для сохранения целостности истории лотерей)
      await client.query(`
        UPDATE users 
        SET username = 'deleted_user', 
            first_name = 'Deleted', 
            last_name = 'User',
            language_code = 'en'
        WHERE telegram_id = $1
      `, [req.user.telegram_id]);

      // Логируем удаление аккаунта
      await client.query(`
        INSERT INTO audit_logs (action, entity_type, entity_id, user_telegram_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'ACCOUNT_DELETED',
        'user',
        req.user.telegram_id,
        req.user.telegram_id,
        JSON.stringify({ deleted_at: new Date().toISOString() })
      ]);
    });

    // Отключаем пользователя от WebSocket
    socketService.disconnectUser(req.user.telegram_id, 'Account deleted');

    res.json({
      success: true,
      message: 'Аккаунт успешно удален'
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;