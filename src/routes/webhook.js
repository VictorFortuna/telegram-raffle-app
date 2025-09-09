const express = require('express');
const telegramService = require('../services/telegramService');

const router = express.Router();

// Webhook для обработки обновлений от Telegram Bot
router.post('/telegram', async (req, res, next) => {
  try {
    const update = req.body;

    // Проверяем, что это валидный update от Telegram
    if (!update || !update.update_id) {
      return res.status(400).json({
        error: 'INVALID_UPDATE',
        message: 'Invalid Telegram update'
      });
    }

    console.log('Received Telegram webhook update:', update.update_id);

    // Обрабатываем update асинхронно
    setImmediate(async () => {
      try {
        await telegramService.processWebhookUpdate(update);
      } catch (error) {
        console.error('Error processing webhook update:', error);
      }
    });

    // Быстро отвечаем Telegram (важно для производительности webhook)
    res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Webhook error:', error);
    // Возвращаем 200 даже при ошибке, чтобы Telegram не повторял запрос
    res.status(200).json({ ok: false, error: error.message });
  }
});

// Webhook для обработки платежей Telegram Stars
router.post('/telegram/payment', async (req, res, next) => {
  try {
    const paymentUpdate = req.body;

    console.log('Received payment webhook:', paymentUpdate);

    // Обрабатываем уведомление о платеже
    if (paymentUpdate.successful_payment) {
      await handleSuccessfulPayment(paymentUpdate.successful_payment, paymentUpdate.from);
    }

    if (paymentUpdate.pre_checkout_query) {
      await handlePreCheckoutQuery(paymentUpdate.pre_checkout_query);
    }

    res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(200).json({ ok: false, error: error.message });
  }
});

// Обработка успешного платежа
async function handleSuccessfulPayment(payment, user) {
  try {
    const db = require('../services/databaseService');
    const User = require('../models/User');
    const socketService = require('../services/socketService');

    console.log(`Processing successful payment: ${payment.telegram_payment_charge_id} for user ${user.id}`);

    // Обновляем статус транзакции в базе данных
    const transactionResult = await db.query(
      'UPDATE star_transactions SET status = $1, completed_at = NOW() WHERE telegram_transaction_id = $2 RETURNING *',
      ['completed', payment.telegram_payment_charge_id]
    );

    if (transactionResult.rows.length === 0) {
      console.warn('Transaction not found in database:', payment.telegram_payment_charge_id);
      return;
    }

    const transaction = transactionResult.rows[0];

    // Обновляем баланс пользователя
    const dbUser = await User.findByTelegramId(user.id);
    if (dbUser) {
      // При успешном платеже баланс уже списан Telegram
      // Обновляем локальный баланс
      const newBalance = Math.max(0, dbUser.stars_balance - transaction.amount);
      await dbUser.updateStarsBalance(newBalance);

      // Уведомляем пользователя через WebSocket
      socketService.notifyUser(user.id, 'payment_confirmed', {
        transaction_id: transaction.telegram_transaction_id,
        amount: transaction.amount,
        type: transaction.transaction_type
      });
    }

    console.log(`✅ Payment processed successfully: ${payment.telegram_payment_charge_id}`);

  } catch (error) {
    console.error('Error handling successful payment:', error);
    
    // Уведомляем администраторов о проблеме
    await telegramService.notifyAdmins(
      `Ошибка обработки платежа: ${payment.telegram_payment_charge_id}`,
      { error: error.message, payment, user }
    );
  }
}

// Обработка pre-checkout query
async function handlePreCheckoutQuery(query) {
  try {
    console.log(`Processing pre-checkout query: ${query.id}`);

    // Здесь можно добавить дополнительные проверки:
    // - Проверить доступность товара/услуги
    // - Проверить баланс пользователя
    // - Проверить лимиты

    // Для лотереи обычно одобряем все pre-checkout queries
    // Telegram Bot API требует ответа в течение 10 секунд
    const bot = telegramService.bot;
    if (bot) {
      await bot.answerPreCheckoutQuery(query.id, true);
      console.log(`✅ Pre-checkout query approved: ${query.id}`);
    }

  } catch (error) {
    console.error('Error handling pre-checkout query:', error);
    
    // Отклоняем платеж при ошибке
    const bot = telegramService.bot;
    if (bot) {
      try {
        await bot.answerPreCheckoutQuery(query.id, false, 'Временная ошибка сервера');
      } catch (rejectError) {
        console.error('Error rejecting pre-checkout query:', rejectError);
      }
    }
  }
}

// Webhook для внешних уведомлений (например, от Railway)
router.post('/system/notification', async (req, res, next) => {
  try {
    const notification = req.body;
    const authHeader = req.headers['authorization'];

    // Проверяем токен авторизации для системных уведомлений
    if (!authHeader || authHeader !== `Bearer ${process.env.SYSTEM_WEBHOOK_TOKEN}`) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid system webhook token'
      });
    }

    console.log('Received system notification:', notification);

    const socketService = require('../services/socketService');

    // Обрабатываем различные типы системных уведомлений
    switch (notification.type) {
      case 'maintenance':
        socketService.notifyMaintenance(
          notification.message || 'Плановые технические работы',
          notification.duration || '30 минут'
        );
        break;

      case 'system_message':
        socketService.notifySystemMessage(
          notification.message,
          notification.level || 'info'
        );
        break;

      case 'deployment':
        if (notification.status === 'completed') {
          socketService.notifySystemMessage(
            'Система обновлена до новой версии',
            'success'
          );
        }
        break;

      default:
        console.log('Unknown system notification type:', notification.type);
    }

    res.json({ success: true, message: 'Notification processed' });

  } catch (error) {
    next(error);
  }
});

// Health check для webhook endpoints
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    webhooks: {
      telegram: 'active',
      payment: 'active',
      system: 'active'
    }
  });
});

// Тестовый endpoint для разработки
router.post('/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { type, data } = req.body;
    const socketService = require('../services/socketService');

    switch (type) {
      case 'new_bid':
        socketService.notifyNewBid(data.raffle, data.bid);
        break;

      case 'raffle_completed':
        socketService.notifyRaffleCompleted(data.raffle, data.winner);
        break;

      case 'system_message':
        socketService.notifySystemMessage(data.message, data.level);
        break;

      default:
        return res.status(400).json({ error: 'Unknown test type' });
    }

    res.json({ success: true, message: 'Test webhook processed' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;