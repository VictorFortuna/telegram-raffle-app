const express = require('express');
const { authenticateToken } = require('./auth');
const Raffle = require('../models/Raffle');
const RaffleSettings = require('../models/RaffleSettings');
const User = require('../models/User');
const telegramService = require('../services/telegramService');
const socketService = require('../services/socketService');

const router = express.Router();

// Применяем аутентификацию ко всем маршрутам лотереи
router.use(authenticateToken);

// Получение текущей активной лотереи
router.get('/current', async (req, res, next) => {
  try {
    const currentRaffle = await Raffle.getCurrentActive();
    const settings = await RaffleSettings.getCurrent();

    if (!currentRaffle && settings) {
      // Создаем новую лотерею если нет активной
      const newRaffle = await Raffle.create(settings);
      
      // Уведомляем всех подключенных пользователей
      socketService.notifyNewRaffleStarted(newRaffle, settings);
      
      return res.json({
        success: true,
        raffle: newRaffle.getPublicInfo(),
        settings: settings.getPublicInfo(),
        message: 'Новая лотерея создана'
      });
    }

    if (!currentRaffle) {
      return res.json({
        success: true,
        raffle: null,
        settings: settings ? settings.getPublicInfo() : null,
        message: 'Нет активной лотереи'
      });
    }

    res.json({
      success: true,
      raffle: currentRaffle.getPublicInfo(),
      settings: settings ? settings.getPublicInfo() : null
    });

  } catch (error) {
    next(error);
  }
});

// Сделать ставку
router.post('/bid', async (req, res, next) => {
  try {
    const { amount, transaction_id } = req.body;

    // Валидация входных данных
    if (!amount || amount < 1) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Сумма ставки должна быть больше 0'
      });
    }

    if (!transaction_id) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'ID транзакции обязателен'
      });
    }

    // Получаем пользователя
    const user = await User.findByTelegramId(req.user.telegram_id);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Пользователь не найден'
      });
    }

    // Получаем текущую активную лотерею
    let currentRaffle = await Raffle.getCurrentActive();
    const settings = await RaffleSettings.getCurrent();

    if (!settings) {
      return res.status(500).json({
        error: 'SETTINGS_NOT_FOUND',
        message: 'Настройки лотереи не найдены'
      });
    }

    // Создаем новую лотерею если нет активной
    if (!currentRaffle) {
      currentRaffle = await Raffle.create(settings);
      socketService.notifyNewRaffleStarted(currentRaffle, settings);
    }

    // Проверяем соответствие суммы ставки настройкам
    if (amount !== settings.bid_amount) {
      return res.status(400).json({
        error: 'INVALID_BID_AMOUNT',
        message: `Сумма ставки должна быть ${settings.bid_amount} звезд`
      });
    }

    // Проверяем баланс пользователя
    try {
      const starsBalance = await telegramService.checkUserStarsBalance(req.user.telegram_id);
      if (starsBalance && starsBalance.balance < amount) {
        return res.status(400).json({
          error: 'INSUFFICIENT_BALANCE',
          message: 'Недостаточно Telegram Stars'
        });
      }
    } catch (balanceError) {
      console.warn('Could not verify stars balance:', balanceError);
      // Продолжаем, полагаясь на проверку транзакции
    }

    // Проверяем валидность транзакции
    try {
      const transactionStatus = await telegramService.checkTransactionStatus(transaction_id);
      
      if (transactionStatus.status !== 'completed') {
        return res.status(400).json({
          error: 'TRANSACTION_NOT_COMPLETED',
          message: 'Транзакция не завершена'
        });
      }

      if (transactionStatus.amount !== amount) {
        return res.status(400).json({
          error: 'AMOUNT_MISMATCH',
          message: 'Сумма транзакции не совпадает со ставкой'
        });
      }
    } catch (transactionError) {
      console.error('Transaction verification failed:', transactionError);
      return res.status(400).json({
        error: 'TRANSACTION_VERIFICATION_FAILED',
        message: 'Не удалось проверить транзакцию'
      });
    }

    // Добавляем участника в лотерею
    try {
      const result = await currentRaffle.addParticipant(req.user.telegram_id, amount, transaction_id);
      
      // Обновляем статистику пользователя
      await user.incrementBidsCount();

      // Записываем транзакцию
      const db = require('../services/databaseService');
      await db.query(`
        INSERT INTO star_transactions (
          telegram_id, transaction_type, amount, telegram_transaction_id,
          raffle_id, bid_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        req.user.telegram_id,
        'bid',
        amount,
        transaction_id,
        currentRaffle.id,
        result.bid.id,
        'completed'
      ]);

      // Уведомляем всех о новой ставке
      socketService.notifyNewBid(result.raffle, result.bid);

      // Проверяем, нужно ли завершить лотерею
      if (result.shouldComplete) {
        await completeRaffle(result.raffle, settings);
      }

      res.json({
        success: true,
        message: 'Ставка принята',
        raffle: result.raffle.getPublicInfo(),
        bid: {
          id: result.bid.id,
          position: result.bid.bid_position,
          amount: result.bid.amount,
          placed_at: result.bid.placed_at
        },
        raffle_completed: result.shouldComplete
      });

    } catch (addParticipantError) {
      // Обрабатываем специфичные ошибки
      if (addParticipantError.message === 'ALREADY_PARTICIPATED') {
        return res.status(400).json({
          error: 'ALREADY_PARTICIPATED',
          message: 'Вы уже участвуете в этой лотерее'
        });
      }

      if (addParticipantError.message === 'RAFFLE_FULL') {
        return res.status(400).json({
          error: 'RAFFLE_FULL',
          message: 'Лотерея уже заполнена'
        });
      }

      throw addParticipantError;
    }

  } catch (error) {
    next(error);
  }
});

// Получение статуса лотереи с участниками
router.get('/status', async (req, res, next) => {
  try {
    const currentRaffle = await Raffle.getCurrentActive();
    
    if (!currentRaffle) {
      return res.json({
        success: true,
        raffle: null,
        participants: [],
        message: 'Нет активной лотереи'
      });
    }

    const participants = await currentRaffle.getParticipants();
    const settings = await RaffleSettings.getCurrent();

    res.json({
      success: true,
      raffle: currentRaffle.getPublicInfo(),
      settings: settings ? settings.getPublicInfo() : null,
      participants: participants.map(p => ({
        position: p.bid_position,
        username: p.username || 'Anonymous',
        first_name: p.first_name || 'User',
        amount: p.amount,
        placed_at: p.placed_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

// Получение истории завершенных лотерей
router.get('/history', async (req, res, next) => {
  try {
    const { limit = 20, page = 1 } = req.query;
    
    const db = require('../services/databaseService');
    
    const baseQuery = `
      SELECT 
        r.*,
        u.username as winner_username,
        u.first_name as winner_first_name,
        COUNT(b.id) as total_participants
      FROM raffles r
      LEFT JOIN users u ON r.winner_telegram_id = u.telegram_id
      LEFT JOIN bids b ON r.id = b.raffle_id AND b.status = 'confirmed'
      WHERE r.status = 'completed'
      GROUP BY r.id, u.username, u.first_name
      ORDER BY r.completed_at DESC
    `;

    const result = await db.paginate(baseQuery, [], parseInt(page), parseInt(limit));

    const history = result.data.map(raffle => ({
      id: raffle.id,
      required_participants: raffle.required_participants,
      total_participants: parseInt(raffle.total_participants),
      total_prize: raffle.total_prize,
      winner_prize: raffle.winner_prize,
      winner_info: {
        username: raffle.winner_username || 'Anonymous',
        first_name: raffle.winner_first_name || 'User'
      },
      created_at: raffle.created_at,
      completed_at: raffle.completed_at
    }));

    res.json({
      success: true,
      history: history,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

// Проверка результатов конкретной лотереи
router.get('/:id/verify', async (req, res, next) => {
  try {
    const raffleId = parseInt(req.params.id);
    
    if (isNaN(raffleId)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Неверный ID лотереи'
      });
    }

    const verification = await Raffle.verifyWinnerSelection(raffleId);

    res.json({
      success: true,
      verification: verification
    });

  } catch (error) {
    next(error);
  }
});

// Получение детальной информации о лотерее
router.get('/:id', async (req, res, next) => {
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

    res.json({
      success: true,
      raffle: raffle.getCompletedInfo(),
      participants: participants.map(p => ({
        position: p.bid_position,
        username: p.username || 'Anonymous',
        first_name: p.first_name || 'User',
        amount: p.amount,
        placed_at: p.placed_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

// Функция завершения лотереи
async function completeRaffle(raffle, settings) {
  try {
    console.log(`🎲 Completing raffle ${raffle.id}...`);

    // Выбираем победителя
    const winnerResult = await raffle.selectWinner(
      settings.winner_percentage,
      settings.admin_percentage
    );

    console.log(`🎉 Raffle ${raffle.id} completed! Winner: ${winnerResult.winner_id}, Prize: ${winnerResult.winner_prize}`);

    // Отправляем приз победителю
    try {
      await telegramService.sendPrizeToWinner(
        winnerResult.winner_id,
        winnerResult.winner_prize,
        raffle.id
      );
    } catch (prizeError) {
      console.error('Failed to send prize to winner:', prizeError);
      // Продолжаем, приз будет отправлен позже через админ панель
    }

    // Уведомляем всех пользователей о завершении лотереи
    socketService.notifyRaffleCompleted(raffle, winnerResult);

    // Создаем новую лотерею
    const newRaffle = await Raffle.create(settings);
    socketService.notifyNewRaffleStarted(newRaffle, settings);

    return winnerResult;

  } catch (error) {
    console.error('Error completing raffle:', error);
    
    // Уведомляем администраторов о проблеме
    await telegramService.notifyAdmins(
      `Ошибка завершения лотереи ${raffle.id}: ${error.message}`,
      { raffleId: raffle.id, error: error.stack }
    );

    throw error;
  }
}

module.exports = router;