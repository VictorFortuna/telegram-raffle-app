const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const RaffleSettings = require('../models/RaffleSettings');
const Raffle = require('../models/Raffle');
const User = require('../models/User');
const telegramService = require('../services/telegramService');
const socketService = require('../services/socketService');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();

// Применяем админский rate limiting
router.use(rateLimiter.admin);

// Вход в админ панель
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Имя пользователя и пароль обязательны'
      });
    }

    // Проверяем учетные данные
    const isValidUsername = username === (process.env.ADMIN_USERNAME || 'admin');
    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

    if (!isValidUsername || !isValidPassword) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверные учетные данные'
      });
    }

    // Создаем JWT токен
    const token = jwt.sign(
      { 
        role: 'admin',
        username: username,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`✅ Admin login: ${username}`);

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token: token,
      expires_in: 8 * 60 * 60 // 8 часов в секундах
    });

  } catch (error) {
    next(error);
  }
});

// Middleware для проверки админских прав
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Токен доступа отсутствует'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err || user.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Недостаточно прав доступа'
      });
    }

    req.admin = user;
    next();
  });
}

// Применяем проверку админских прав ко всем последующим маршрутам
router.use(requireAdmin);

// Получение настроек лотереи
router.get('/settings', async (req, res, next) => {
  try {
    const currentSettings = await RaffleSettings.getCurrent();
    const settingsHistory = await RaffleSettings.getHistory(10);

    res.json({
      success: true,
      current: currentSettings ? currentSettings.toJSON() : null,
      history: settingsHistory.map(s => s.toJSON())
    });

  } catch (error) {
    next(error);
  }
});

// Обновление настроек лотереи
router.put('/settings', async (req, res, next) => {
  try {
    const { required_participants, bid_amount, winner_percentage, admin_percentage } = req.body;

    const settingsData = {
      required_participants: parseInt(required_participants),
      bid_amount: parseInt(bid_amount),
      winner_percentage: parseFloat(winner_percentage),
      admin_percentage: parseFloat(admin_percentage)
    };

    const currentSettings = await RaffleSettings.getCurrent();
    let newSettings;

    if (currentSettings) {
      newSettings = await RaffleSettings.update(currentSettings.id, settingsData);
    } else {
      newSettings = await RaffleSettings.create(settingsData);
    }

    console.log(`⚙️ Settings updated by admin ${req.admin.username}:`, settingsData);

    // Логируем изменение настроек
    const db = require('../services/databaseService');
    await db.query(`
      INSERT INTO audit_logs (action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4)
    `, [
      'SETTINGS_UPDATED',
      'raffle_settings',
      newSettings.id,
      JSON.stringify({
        admin: req.admin.username,
        old_settings: currentSettings ? currentSettings.toJSON() : null,
        new_settings: newSettings.toJSON()
      })
    ]);

    // Уведомляем всех пользователей об изменении настроек
    socketService.notifySystemMessage(
      'Настройки лотереи обновлены',
      'info'
    );

    res.json({
      success: true,
      message: 'Настройки обновлены',
      settings: newSettings.toJSON()
    });

  } catch (error) {
    next(error);
  }
});

// Получение всех лотерей
router.get('/raffles', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const db = require('../services/databaseService');

    let baseQuery = `
      SELECT 
        r.*,
        u.username as winner_username,
        u.first_name as winner_first_name,
        COUNT(b.id) as total_participants
      FROM raffles r
      LEFT JOIN users u ON r.winner_telegram_id = u.telegram_id
      LEFT JOIN bids b ON r.id = b.raffle_id AND b.status = 'confirmed'
    `;

    const params = [];

    if (status && ['active', 'completed', 'cancelled'].includes(status)) {
      baseQuery += ' WHERE r.status = $1';
      params.push(status);
    }

    baseQuery += ' GROUP BY r.id, u.username, u.first_name ORDER BY r.created_at DESC';

    const result = await db.paginate(baseQuery, params, parseInt(page), parseInt(limit));

    const raffles = result.data.map(raffle => ({
      ...raffle,
      total_participants: parseInt(raffle.total_participants),
      winner_info: raffle.winner_username ? {
        username: raffle.winner_username,
        first_name: raffle.winner_first_name
      } : null
    }));

    res.json({
      success: true,
      raffles: raffles,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

// Получение детальной информации о лотерее
router.get('/raffles/:id', async (req, res, next) => {
  try {
    const raffleId = parseInt(req.params.id);
    
    if (isNaN(raffleId)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Неверный ID лотереи'
      });
    }

    const raffle = await Raffle.findById(raffleId);
    
    if (!raffle) {
      return res.status(404).json({
        error: 'RAFFLE_NOT_FOUND',
        message: 'Лотерея не найдена'
      });
    }

    const participants = await raffle.getParticipants();

    // Проверка справедливости результата (для завершенных лотерей)
    let verification = null;
    if (raffle.status === 'completed') {
      try {
        verification = await Raffle.verifyWinnerSelection(raffleId);
      } catch (verifyError) {
        console.error('Verification error:', verifyError);
      }
    }

    res.json({
      success: true,
      raffle: {
        ...raffle.getCompletedInfo(),
        verification: verification
      },
      participants: participants.map(p => ({
        telegram_id: p.user_telegram_id,
        position: p.bid_position,
        username: p.username || 'Anonymous',
        first_name: p.first_name || 'User',
        last_name: p.last_name,
        amount: p.amount,
        transaction_id: p.transaction_id,
        placed_at: p.placed_at,
        confirmed_at: p.confirmed_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

// Отмена лотереи
router.post('/raffles/:id/cancel', async (req, res, next) => {
  try {
    const raffleId = parseInt(req.params.id);
    const { reason } = req.body;
    
    if (isNaN(raffleId)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Неверный ID лотереи'
      });
    }

    const raffle = await Raffle.findById(raffleId);
    
    if (!raffle) {
      return res.status(404).json({
        error: 'RAFFLE_NOT_FOUND',
        message: 'Лотерея не найдена'
      });
    }

    if (raffle.status !== 'active') {
      return res.status(400).json({
        error: 'RAFFLE_NOT_ACTIVE',
        message: 'Можно отменить только активные лотереи'
      });
    }

    const db = require('../services/databaseService');

    await db.transaction(async (client) => {
      // Получаем всех участников для возврата средств
      const participants = await client.query(
        'SELECT * FROM bids WHERE raffle_id = $1 AND status = $2',
        [raffleId, 'confirmed']
      );

      // Обновляем статус лотереи
      await client.query(
        'UPDATE raffles SET status = $1 WHERE id = $2',
        ['cancelled', raffleId]
      );

      // Обновляем статус всех ставок
      await client.query(
        'UPDATE bids SET status = $1 WHERE raffle_id = $2',
        ['refunded', raffleId]
      );

      // Записываем транзакции возврата
      for (const participant of participants.rows) {
        await client.query(`
          INSERT INTO star_transactions (
            telegram_id, transaction_type, amount, raffle_id, 
            bid_id, status, created_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [
          participant.user_telegram_id,
          'refund',
          participant.amount,
          raffleId,
          participant.id,
          'completed'
        ]);
      }

      // Логируем отмену лотереи
      await client.query(`
        INSERT INTO audit_logs (action, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4)
      `, [
        'RAFFLE_CANCELLED',
        'raffle',
        raffleId,
        JSON.stringify({
          admin: req.admin.username,
          reason: reason || 'No reason provided',
          participants_count: participants.rows.length,
          total_refunded: participants.rows.reduce((sum, p) => sum + p.amount, 0)
        })
      ]);
    });

    // Возвращаем средства участникам через Telegram
    const participants = await raffle.getParticipants();
    for (const participant of participants) {
      try {
        await telegramService.refundParticipant(
          participant.user_telegram_id,
          participant.amount,
          reason || 'Лотерея отменена администратором'
        );
      } catch (refundError) {
        console.error('Refund error for user', participant.user_telegram_id, refundError);
      }
    }

    // Уведомляем всех пользователей
    socketService.notifySystemMessage(
      `Лотерея №${raffleId} была отменена. Средства возвращены участникам.`,
      'warning'
    );

    console.log(`🚫 Raffle ${raffleId} cancelled by admin ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Лотерея отменена, средства возвращены участникам'
    });

  } catch (error) {
    next(error);
  }
});

// Создание новой лотереи вручную
router.post('/raffles/create', async (req, res, next) => {
  try {
    const settings = await RaffleSettings.getCurrent();
    
    if (!settings) {
      return res.status(400).json({
        error: 'SETTINGS_NOT_FOUND',
        message: 'Настройки лотереи не найдены'
      });
    }

    // Проверяем, нет ли активной лотереи
    const activeRaffle = await Raffle.getCurrentActive();
    if (activeRaffle) {
      return res.status(400).json({
        error: 'ACTIVE_RAFFLE_EXISTS',
        message: 'Уже существует активная лотерея'
      });
    }

    const newRaffle = await Raffle.create(settings);

    // Логируем создание лотереи
    const db = require('../services/databaseService');
    await db.query(`
      INSERT INTO audit_logs (action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4)
    `, [
      'RAFFLE_CREATED_MANUAL',
      'raffle',
      newRaffle.id,
      JSON.stringify({
        admin: req.admin.username,
        settings: settings.toJSON()
      })
    ]);

    // Уведомляем пользователей о новой лотерее
    socketService.notifyNewRaffleStarted(newRaffle, settings);

    console.log(`🎲 New raffle created manually by admin ${req.admin.username}: ${newRaffle.id}`);

    res.json({
      success: true,
      message: 'Новая лотерея создана',
      raffle: newRaffle.getPublicInfo()
    });

  } catch (error) {
    next(error);
  }
});

// Получение списка пользователей
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search, order_by = 'created_at', order = 'desc' } = req.query;
    const db = require('../services/databaseService');

    let baseQuery = `
      SELECT 
        telegram_id, username, first_name, last_name,
        stars_balance, total_bids, total_winnings,
        created_at, last_active, last_balance_check
      FROM users
    `;

    const params = [];

    // Поиск по имени или username
    if (search) {
      baseQuery += ' WHERE (username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)';
      params.push(`%${search}%`);
    }

    // Сортировка
    const validOrderBy = ['created_at', 'last_active', 'total_bids', 'total_winnings', 'stars_balance'];
    const validOrder = ['asc', 'desc'];
    
    if (validOrderBy.includes(order_by) && validOrder.includes(order.toLowerCase())) {
      baseQuery += ` ORDER BY ${order_by} ${order.toUpperCase()}`;
    } else {
      baseQuery += ' ORDER BY created_at DESC';
    }

    const result = await db.paginate(baseQuery, params, parseInt(page), parseInt(limit));

    res.json({
      success: true,
      users: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

// Получение детальной информации о пользователе
router.get('/users/:telegram_id', async (req, res, next) => {
  try {
    const telegramId = req.params.telegram_id;
    
    const user = await User.findByTelegramId(telegramId);
    
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    const db = require('../services/databaseService');

    // История участия в лотереях
    const raffleHistory = await db.query(`
      SELECT 
        r.id as raffle_id,
        r.status as raffle_status,
        r.total_prize,
        r.winner_telegram_id,
        b.amount as bid_amount,
        b.placed_at,
        b.confirmed_at,
        r.completed_at,
        CASE WHEN r.winner_telegram_id = $1 THEN r.winner_prize ELSE 0 END as won_amount
      FROM bids b
      JOIN raffles r ON b.raffle_id = r.id
      WHERE b.user_telegram_id = $1
      ORDER BY b.placed_at DESC
      LIMIT 50
    `, [telegramId]);

    // История транзакций
    const transactions = await db.query(`
      SELECT * FROM star_transactions 
      WHERE telegram_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `, [telegramId]);

    res.json({
      success: true,
      user: user.getFullProfile(),
      raffle_history: raffleHistory.rows,
      transactions: transactions.rows
    });

  } catch (error) {
    next(error);
  }
});

// Отправка уведомления пользователю
router.post('/users/:telegram_id/notify', async (req, res, next) => {
  try {
    const telegramId = req.params.telegram_id;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Сообщение обязательно'
      });
    }

    const user = await User.findByTelegramId(telegramId);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    // Отправляем уведомление через Telegram
    try {
      await telegramService.bot.sendMessage(telegramId, `📢 Уведомление от администратора:\n\n${message}`);
    } catch (telegramError) {
      console.error('Error sending Telegram message:', telegramError);
    }

    // Отправляем через WebSocket если пользователь онлайн
    socketService.notifyUser(telegramId, 'admin_message', {
      message: message,
      from: 'Администратор'
    });

    console.log(`📢 Admin ${req.admin.username} sent message to user ${telegramId}`);

    res.json({
      success: true,
      message: 'Уведомление отправлено'
    });

  } catch (error) {
    next(error);
  }
});

// Массовая рассылка
router.post('/broadcast', async (req, res, next) => {
  try {
    const { message, target = 'all' } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Сообщение обязательно'
      });
    }

    const db = require('../services/databaseService');
    let userQuery = 'SELECT telegram_id FROM users';
    const params = [];

    // Выбор целевой аудитории
    switch (target) {
      case 'active_24h':
        userQuery += ' WHERE last_active > NOW() - INTERVAL \'24 hours\'';
        break;
      case 'with_bids':
        userQuery += ' WHERE total_bids > 0';
        break;
      case 'winners':
        userQuery += ' WHERE total_winnings > 0';
        break;
      case 'all':
      default:
        // Все пользователи
        break;
    }

    const usersResult = await db.query(userQuery, params);
    const userIds = usersResult.rows.map(row => row.telegram_id);

    if (userIds.length === 0) {
      return res.json({
        success: true,
        message: 'Нет пользователей для рассылки',
        sent: 0
      });
    }

    // Отправляем через Telegram Bot
    const broadcastMessage = `📢 Сообщение от администратора:\n\n${message}`;
    const results = await telegramService.broadcastMessage(userIds, broadcastMessage);

    // Отправляем через WebSocket
    socketService.broadcastToAll('admin_broadcast', {
      message: message,
      from: 'Администратор'
    });

    // Логируем рассылку
    await db.query(`
      INSERT INTO audit_logs (action, entity_type, details)
      VALUES ($1, $2, $3)
    `, [
      'ADMIN_BROADCAST',
      'broadcast',
      JSON.stringify({
        admin: req.admin.username,
        target: target,
        message: message,
        total_users: userIds.length,
        sent: results.sent,
        failed: results.failed
      })
    ]);

    console.log(`📢 Admin ${req.admin.username} sent broadcast to ${results.sent} users`);

    res.json({
      success: true,
      message: 'Рассылка завершена',
      total_users: userIds.length,
      sent: results.sent,
      failed: results.failed
    });

  } catch (error) {
    next(error);
  }
});

// Получение логов аудита
router.get('/audit', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, entity_type } = req.query;
    const db = require('../services/databaseService');

    let baseQuery = 'SELECT * FROM audit_logs';
    const params = [];

    const conditions = [];

    if (action) {
      conditions.push(`action = $${params.length + 1}`);
      params.push(action);
    }

    if (entity_type) {
      conditions.push(`entity_type = $${params.length + 1}`);
      params.push(entity_type);
    }

    if (conditions.length > 0) {
      baseQuery += ' WHERE ' + conditions.join(' AND ');
    }

    baseQuery += ' ORDER BY created_at DESC';

    const result = await db.paginate(baseQuery, params, parseInt(page), parseInt(limit));

    res.json({
      success: true,
      logs: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

// Системная информация
router.get('/system', async (req, res, next) => {
  try {
    const db = require('../services/databaseService');

    // Статистика базы данных
    const dbStats = await db.query(`
      SELECT 
        'users' as table_name, COUNT(*) as count FROM users
      UNION ALL
      SELECT 'raffles', COUNT(*) FROM raffles
      UNION ALL
      SELECT 'bids', COUNT(*) FROM bids
      UNION ALL
      SELECT 'star_transactions', COUNT(*) FROM star_transactions
      UNION ALL
      SELECT 'audit_logs', COUNT(*) FROM audit_logs
    `);

    const connectionStats = socketService.getConnectionStats();

    const systemInfo = {
      database: {
        tables: dbStats.rows,
        connection_pool: {
          // Информация о пуле соединений PostgreSQL
          total_connections: db.pool.totalCount,
          idle_connections: db.pool.idleCount,
          waiting_connections: db.pool.waitingCount
        }
      },
      websockets: connectionStats,
      server: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV
      }
    };

    res.json({
      success: true,
      system: systemInfo
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;