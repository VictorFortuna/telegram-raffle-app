const TelegramBot = require('node-telegram-bot-api');

class TelegramService {
  constructor() {
    this.bot = null;
    this.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    this.initialize();
  }

  initialize() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('⚠️  TELEGRAM_BOT_TOKEN not provided. Telegram integration disabled.');
      return;
    }

    try {
      this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
      
      if (process.env.NODE_ENV === 'production' && this.webhookUrl) {
        this.setupWebhook();
      } else if (process.env.NODE_ENV === 'development') {
        this.bot.startPolling();
        console.log('🔄 Telegram bot polling started (development mode)');
      }

      this.setupCommands();
      console.log('✅ Telegram service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Telegram service:', error);
    }
  }

  async setupWebhook() {
    try {
      await this.bot.setWebHook(this.webhookUrl);
      console.log('✅ Telegram webhook set:', this.webhookUrl);
    } catch (error) {
      console.error('❌ Failed to set webhook:', error);
    }
  }

  setupCommands() {
    if (!this.bot) return;

    // Команда /start
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const welcomeMessage = `
🎲 Добро пожаловать в Telegram Raffle Stars!

Это лотерея, где вы можете выиграть Telegram Stars!

🎮 Как играть:
1. Нажмите кнопку "Открыть приложение"
2. Сделайте ставку используя Telegram Stars
3. Дождитесь завершения лотереи
4. Если повезет - получите приз!

💫 Удачи в игре!
      `;

      const keyboard = {
        inline_keyboard: [[{
          text: '🎮 Открыть приложение',
          web_app: { url: process.env.MINI_APP_URL || 'https://your-app.railway.app' }
        }]]
      };

      this.bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: keyboard
      });
    });

    // Команда /help
    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `
ℹ️ Помощь - Telegram Raffle Stars

🎯 Правила игры:
• Сделайте ставку в Telegram Stars
• Дождитесь набора необходимого количества участников
• Победитель определяется честным алгоритмом
• Победитель получает 70% от общего банка
• 30% идет на развитие проекта

⚡ Команды:
/start - Запуск приложения
/help - Эта справка
/stats - Общая статистика

💬 Поддержка: @support_username
      `;

      this.bot.sendMessage(chatId, helpMessage);
    });

    // Команда /stats
    this.bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        // Здесь будем получать статистику из базы данных
        const statsMessage = `
📊 Статистика системы:

👥 Всего пользователей: загрузка...
🎲 Завершенных лотерей: загрузка...
💰 Выдано призов: загрузка... ⭐

Актуальная статистика в приложении!
        `;

        const keyboard = {
          inline_keyboard: [[{
            text: '📊 Открыть статистику',
            web_app: { url: process.env.MINI_APP_URL || 'https://your-app.railway.app' }
          }]]
        };

        this.bot.sendMessage(chatId, statsMessage, {
          reply_markup: keyboard
        });
      } catch (error) {
        console.error('Error getting stats:', error);
        this.bot.sendMessage(chatId, '❌ Ошибка получения статистики');
      }
    });
  }

  // Проверка баланса Telegram Stars пользователя
  async checkUserStarsBalance(userId) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      // В реальной реализации здесь будет запрос к Telegram Stars API
      // На данный момент Telegram Stars API может быть ограничен
      // Для MVP можем использовать Mock данные или базовую проверку
      
      console.log(`Checking stars balance for user ${userId}`);
      
      // TODO: Реализовать реальную проверку баланса через Telegram Stars API
      // Пока возвращаем мок-данные для разработки
      return {
        user_id: userId,
        balance: Math.floor(Math.random() * 100) + 10, // Mock: 10-110 звезд
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error checking user stars balance:', error);
      throw error;
    }
  }

  // Создание счета для оплаты Telegram Stars
  async createStarsInvoice(userId, amount, description) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      console.log(`Creating stars invoice for user ${userId}, amount: ${amount}`);

      // TODO: Реализовать создание инвойса через Telegram Stars API
      // На данный момент возвращаем мок-объект
      const invoiceId = `inv_${Date.now()}_${userId}`;
      
      return {
        invoice_id: invoiceId,
        amount: amount,
        description: description,
        pay_url: `tg://invoice/${invoiceId}`,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 минут
      };
    } catch (error) {
      console.error('Error creating stars invoice:', error);
      throw error;
    }
  }

  // Проверка статуса транзакции
  async checkTransactionStatus(transactionId) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      console.log(`Checking transaction status: ${transactionId}`);

      // TODO: Реализовать проверку статуса через Telegram Stars API
      // Пока возвращаем мок-данные
      const statuses = ['pending', 'completed', 'failed'];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

      return {
        transaction_id: transactionId,
        status: randomStatus,
        amount: Math.floor(Math.random() * 10) + 1,
        created_at: new Date().toISOString(),
        completed_at: randomStatus === 'completed' ? new Date().toISOString() : null
      };
    } catch (error) {
      console.error('Error checking transaction status:', error);
      throw error;
    }
  }

  // Отправка приза победителю
  async sendPrizeToWinner(userId, amount, raffleId) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      console.log(`Sending prize ${amount} stars to user ${userId} for raffle ${raffleId}`);

      // TODO: Реализовать отправку Telegram Stars победителю
      // Пока логируем операцию
      
      // Отправляем уведомление победителю
      const congratsMessage = `
🎉 ПОЗДРАВЛЯЕМ! 🎉

Вы выиграли в лотерее №${raffleId}!
💰 Ваш приз: ${amount} ⭐ Telegram Stars

Звезды уже зачислены на ваш счет!
Спасибо за участие! 🚀
      `;

      await this.bot.sendMessage(userId, congratsMessage);

      return {
        success: true,
        transaction_id: `prize_${Date.now()}_${userId}`,
        amount: amount,
        sent_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error sending prize to winner:', error);
      throw error;
    }
  }

  // Возврат средств при отмене лотереи
  async refundParticipant(userId, amount, reason) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      console.log(`Refunding ${amount} stars to user ${userId}. Reason: ${reason}`);

      // TODO: Реализовать возврат Telegram Stars
      
      // Отправляем уведомление о возврате
      const refundMessage = `
💰 Возврат средств

Вам возвращено ${amount} ⭐ Telegram Stars
Причина: ${reason}

Звезды зачислены на ваш счет.
      `;

      await this.bot.sendMessage(userId, refundMessage);

      return {
        success: true,
        transaction_id: `refund_${Date.now()}_${userId}`,
        amount: amount,
        refunded_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error refunding participant:', error);
      throw error;
    }
  }

  // Обработка webhook от Telegram
  async processWebhookUpdate(update) {
    try {
      if (!this.bot) {
        console.warn('Telegram bot not initialized, ignoring webhook');
        return;
      }

      console.log('Processing Telegram webhook update:', update.update_id);

      // Обрабатываем сообщения
      if (update.message) {
        await this.bot.processUpdate(update);
      }

      // Обрабатываем pre_checkout_query для Telegram Stars
      if (update.pre_checkout_query) {
        const query = update.pre_checkout_query;
        console.log('Pre-checkout query received:', query.id);

        // Здесь можно добавить дополнительные проверки
        // Пока автоматически одобряем
        await this.bot.answerPreCheckoutQuery(query.id, true);
      }

      // Обрабатываем successful_payment
      if (update.message && update.message.successful_payment) {
        const payment = update.message.successful_payment;
        console.log('Successful payment received:', payment);

        // Здесь нужно обновить статус транзакции в базе данных
        // И обработать добавление участника в лотерею
      }

    } catch (error) {
      console.error('Error processing webhook update:', error);
    }
  }

  // Отправка уведомлений администраторам
  async notifyAdmins(message, data = {}) {
    try {
      if (!this.bot || !process.env.ADMIN_CHAT_ID) {
        console.log('Admin notifications disabled');
        return;
      }

      const adminMessage = `
🚨 Admin Notification

${message}

${Object.keys(data).length > 0 ? `Data: ${JSON.stringify(data, null, 2)}` : ''}

Time: ${new Date().toLocaleString('ru-RU')}
      `;

      await this.bot.sendMessage(process.env.ADMIN_CHAT_ID, adminMessage);
    } catch (error) {
      console.error('Error sending admin notification:', error);
    }
  }

  // Массовое уведомление пользователей
  async broadcastMessage(userIds, message) {
    if (!this.bot) return;

    const results = { sent: 0, failed: 0 };

    for (const userId of userIds) {
      try {
        await this.bot.sendMessage(userId, message);
        results.sent++;
        
        // Небольшая задержка между сообщениями
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
        results.failed++;
      }
    }

    console.log(`Broadcast completed: ${results.sent} sent, ${results.failed} failed`);
    return results;
  }

  // Получение информации о пользователе
  async getUserInfo(userId) {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      const chatMember = await this.bot.getChatMember(userId, userId);
      return {
        id: chatMember.user.id,
        username: chatMember.user.username,
        first_name: chatMember.user.first_name,
        last_name: chatMember.user.last_name,
        language_code: chatMember.user.language_code
      };
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  // Проверка валидности Telegram Mini App данных
  validateWebAppData(initData) {
    try {
      // TODO: Реализовать валидацию данных от Telegram Mini App
      // Используя секретный ключ бота для проверки подписи
      console.log('Validating web app data:', initData);
      
      // Пока возвращаем true для разработки
      return true;
    } catch (error) {
      console.error('Error validating web app data:', error);
      return false;
    }
  }
}

module.exports = new TelegramService();