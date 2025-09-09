// Основное приложение Telegram Raffle Stars
class RaffleApp {
  constructor() {
    this.isInitialized = false;
    this.currentRaffle = null;
    this.currentSettings = null;
    this.userData = null;
    this.isParticipating = false;
    this.connectionRetries = 0;
    this.maxConnectionRetries = 5;
    
    // Состояние приложения
    this.state = {
      isLoading: true,
      isConnected: false,
      isAuthenticated: false,
      lastUpdate: null
    };
  }

  // Инициализация приложения
  async init() {
    if (this.isInitialized) return;

    try {
      console.log('🚀 Initializing Raffle App...');
      
      UI.showLoading(CONFIG.TEXTS.LOADING);
      
      // Проверяем Telegram WebApp
      this.initTelegramWebApp();
      
      // Инициализируем обработчики событий
      this.setupEventHandlers();
      
      // Пытаемся аутентифицироваться
      await this.authenticate();
      
      // Подключаемся к WebSocket
      await this.connectWebSocket();
      
      // Загружаем начальные данные
      await this.loadInitialData();
      
      // Показываем основной экран
      UI.showScreen('main');
      
      this.isInitialized = true;
      this.state.isLoading = false;
      
      console.log('✅ Raffle App initialized successfully');

    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
      this.handleInitError(error);
    }
  }

  // Инициализация Telegram WebApp
  initTelegramWebApp() {
    if (!CONFIG.TELEGRAM_WEB_APP) {
      console.warn('⚠️ Telegram WebApp not available');
      return;
    }

    const webapp = CONFIG.TELEGRAM_WEB_APP;
    
    // Настраиваем интерфейс
    webapp.ready();
    webapp.expand();
    
    // Настраиваем тему
    webapp.setBackgroundColor('#1a1a2e');
    webapp.setHeaderColor('#16213e');
    
    // Скрываем главную кнопку
    webapp.MainButton.hide();
    
    console.log('✅ Telegram WebApp configured');
  }

  // Настройка обработчиков событий
  setupEventHandlers() {
    // События UI
    UI.on('bid_clicked', () => this.handleBidClick());
    UI.on('retry_clicked', () => this.handleRetryClick());

    // События WebSocket
    SOCKET.on('status_changed', (status) => this.handleConnectionStatusChange(status));
    SOCKET.on('authenticated', (data) => this.handleAuthenticated(data));
    SOCKET.on('auth_error', (error) => this.handleAuthError(error));
    
    // События лотереи
    SOCKET.on('raffle_update', (data) => this.handleRaffleUpdate(data));
    SOCKET.on('new_bid', (data) => this.handleNewBid(data));
    SOCKET.on('raffle_completed', (data) => this.handleRaffleCompleted(data));
    SOCKET.on('you_won', (data) => this.handleYouWon(data));
    SOCKET.on('new_raffle', (data) => this.handleNewRaffle(data));
    
    // Пользовательские события
    SOCKET.on('user_stats_update', (data) => this.handleUserStatsUpdate(data));
    SOCKET.on('transaction_error', (data) => this.handleTransactionError(data));
    SOCKET.on('refund_notification', (data) => this.handleRefundNotification(data));
    
    // Системные события
    SOCKET.on('admin_message', (data) => this.handleAdminMessage(data));
    SOCKET.on('system_message', (data) => this.handleSystemMessage(data));
    SOCKET.on('maintenance_notification', (data) => this.handleMaintenanceNotification(data));
    
    // События сети
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));
  }

  // === АУТЕНТИФИКАЦИЯ ===

  // Аутентификация пользователя
  async authenticate() {
    try {
      // Проверяем существующий токен
      const existingToken = UTILS.storage.get(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
      if (existingToken && UTILS.isTokenValid(existingToken)) {
        const verifyResult = await API.verifyToken();
        if (verifyResult.success) {
          this.userData = verifyResult.user;
          this.state.isAuthenticated = true;
          return;
        }
      }

      // Аутентификация через Telegram
      const telegramUser = API.getTelegramUser();
      if (!telegramUser) {
        throw new Error('Telegram user data not available');
      }

      const authResult = await API.authenticateWithTelegram(telegramUser);
      if (authResult.success) {
        this.userData = authResult.user;
        this.state.isAuthenticated = true;
        console.log('✅ User authenticated:', this.userData.telegram_id);
      } else {
        throw new Error(authResult.message || 'Authentication failed');
      }

    } catch (error) {
      console.error('❌ Authentication failed:', error);
      throw new Error('Не удалось войти в систему');
    }
  }

  // === ПОДКЛЮЧЕНИЕ ===

  // Подключение к WebSocket
  async connectWebSocket() {
    try {
      await SOCKET.connect();
      this.state.isConnected = true;
      console.log('✅ WebSocket connected');
    } catch (error) {
      console.error('❌ WebSocket connection failed:', error);
      
      if (this.connectionRetries < this.maxConnectionRetries) {
        this.connectionRetries++;
        console.log(`🔄 Retrying WebSocket connection (${this.connectionRetries}/${this.maxConnectionRetries})`);
        await UTILS.delay(2000 * this.connectionRetries);
        return await this.connectWebSocket();
      }
      
      throw new Error('Не удалось подключиться к серверу');
    }
  }

  // === ЗАГРУЗКА ДАННЫХ ===

  // Загрузка начальных данных
  async loadInitialData() {
    try {
      // Загружаем данные параллельно
      const [raffleData, globalStats, userBalance] = await Promise.allSettled([
        API.getCurrentRaffle(),
        API.getGlobalStats(),
        API.getUserBalance()
      ]);

      // Обрабатываем данные лотереи
      if (raffleData.status === 'fulfilled' && raffleData.value.success) {
        this.currentRaffle = raffleData.value.raffle;
        this.currentSettings = raffleData.value.settings;
        this.updateRaffleUI();
      }

      // Обрабатываем глобальную статистику
      if (globalStats.status === 'fulfilled' && globalStats.value.success) {
        UI.updateGlobalStats(globalStats.value.stats);
        UI.updateRecentWinners(globalStats.value.stats.recent_winners);
      }

      // Обрабатываем баланс пользователя
      if (userBalance.status === 'fulfilled' && userBalance.value.success) {
        this.userData.stars_balance = userBalance.value.balance;
        UI.updateUserData(this.userData);
      }

      // Проверяем участие в текущей лотерее
      await this.checkUserParticipation();

    } catch (error) {
      console.error('❌ Failed to load initial data:', error);
      // Не прерываем инициализацию из-за ошибок загрузки данных
    }
  }

  // Проверка участия пользователя в лотерее
  async checkUserParticipation() {
    if (!this.currentRaffle) return;

    try {
      const statusData = await API.getRaffleStatus();
      if (statusData.success && statusData.participants) {
        this.isParticipating = statusData.participants.some(
          p => p.telegram_id === this.userData.telegram_id
        );
        this.updateBidButtonState();
      }
    } catch (error) {
      console.error('❌ Failed to check user participation:', error);
    }
  }

  // === ОБРАБОТЧИКИ СОБЫТИЙ UI ===

  // Обработка клика по кнопке ставки
  async handleBidClick() {
    if (this.isParticipating) {
      UI.showNotification('Вы уже участвуете в этой лотерее', CONFIG.NOTIFICATION_TYPES.WARNING);
      return;
    }

    if (!this.currentSettings || !this.userData) {
      UI.showNotification('Данные не загружены', CONFIG.NOTIFICATION_TYPES.ERROR);
      return;
    }

    const bidAmount = this.currentSettings.bid_amount;
    
    // Проверяем баланс
    if (this.userData.stars_balance < bidAmount) {
      UI.showNotification(
        `Недостаточно звезд. Нужно: ${bidAmount} ⭐`,
        CONFIG.NOTIFICATION_TYPES.ERROR
      );
      return;
    }

    try {
      UI.updateBidButton('loading');
      UTILS.vibrate('light');

      // Создаем инвойс для оплаты
      const invoice = await API.createPaymentInvoice(
        bidAmount,
        `Ставка в лотерее #${this.currentRaffle?.id || 'unknown'}`
      );

      if (!invoice.success) {
        throw new Error('Не удалось создать счет для оплаты');
      }

      // Имитируем оплату (в реальной реализации здесь будет Telegram Stars API)
      await this.processPayment(invoice, bidAmount);

    } catch (error) {
      console.error('❌ Bid error:', error);
      UI.showNotification(error.message || 'Ошибка при создании ставки', CONFIG.NOTIFICATION_TYPES.ERROR);
      this.updateBidButtonState();
    }
  }

  // Обработка оплаты
  async processPayment(invoice, amount) {
    try {
      // В реальной реализации здесь будет интеграция с Telegram Stars
      // Пока имитируем успешную оплату
      await UTILS.delay(2000);
      
      const transactionId = `mock_${Date.now()}`;
      
      // Отправляем ставку на сервер
      const bidResult = await API.placeBid(amount, transactionId);
      
      if (bidResult.success) {
        this.isParticipating = true;
        this.userData.stars_balance -= amount;
        
        UI.updateUserData(this.userData);
        UI.updateBidButton('participating');
        UI.updateUserParticipation(true);
        
        UI.showNotification('Ставка принята! Удачи!', CONFIG.NOTIFICATION_TYPES.SUCCESS);
        UTILS.vibrate('medium');
        
        if (bidResult.raffle_completed) {
          UI.showNotification('Лотерея завершается!', CONFIG.NOTIFICATION_TYPES.INFO);
        }
      } else {
        throw new Error(bidResult.message || 'Ставка не принята');
      }

    } catch (error) {
      console.error('❌ Payment processing error:', error);
      throw error;
    }
  }

  // Обработка повтора действия
  async handleRetryClick() {
    try {
      UI.showLoading('Повторное подключение...');
      await this.init();
    } catch (error) {
      UI.showError(error.message || 'Ошибка подключения', () => this.handleRetryClick());
    }
  }

  // === ОБРАБОТЧИКИ СОБЫТИЙ WEBSOCKET ===

  // Изменение статуса подключения
  handleConnectionStatusChange(status) {
    this.state.isConnected = (status === CONFIG.CONNECTION_STATUS.CONNECTED);
    
    let message, type;
    switch (status) {
      case CONFIG.CONNECTION_STATUS.CONNECTED:
        message = CONFIG.TEXTS.CONNECTED;
        type = CONFIG.NOTIFICATION_TYPES.SUCCESS;
        this.connectionRetries = 0;
        break;
      case CONFIG.CONNECTION_STATUS.CONNECTING:
        message = CONFIG.TEXTS.CONNECTING;
        type = CONFIG.NOTIFICATION_TYPES.INFO;
        break;
      case CONFIG.CONNECTION_STATUS.RECONNECTING:
        message = CONFIG.TEXTS.RECONNECTING;
        type = CONFIG.NOTIFICATION_TYPES.WARNING;
        break;
      case CONFIG.CONNECTION_STATUS.DISCONNECTED:
        message = CONFIG.TEXTS.DISCONNECTED;
        type = CONFIG.NOTIFICATION_TYPES.ERROR;
        break;
    }
    
    if (this.isInitialized) {
      UI.showNotification(message, type, 2000);
    }
  }

  // Успешная аутентификация WebSocket
  handleAuthenticated(data) {
    console.log('✅ WebSocket authenticated');
    SOCKET.requestRaffleStatus();
    SOCKET.requestGlobalStats();
    SOCKET.requestRecentWinners();
  }

  // Ошибка аутентификации WebSocket
  handleAuthError(error) {
    console.error('❌ WebSocket auth error:', error);
    UI.showNotification('Ошибка авторизации', CONFIG.NOTIFICATION_TYPES.ERROR);
  }

  // Обновление лотереи
  handleRaffleUpdate(data) {
    if (data.raffle) {
      this.currentRaffle = data.raffle;
    }
    if (data.settings) {
      this.currentSettings = data.settings;
    }
    
    this.updateRaffleUI();
    this.state.lastUpdate = new Date();
  }

  // Новая ставка
  handleNewBid(data) {
    if (data.raffle) {
      this.currentRaffle = { ...this.currentRaffle, ...data.raffle };
      this.updateRaffleUI();
    }
    
    UTILS.vibrate('light');
  }

  // Завершение лотереи
  handleRaffleCompleted(data) {
    UI.showNotification(
      `Лотерея завершена! Победитель получил ${UTILS.formatStars(data.winner.prize)}`,
      CONFIG.NOTIFICATION_TYPES.SUCCESS,
      5000
    );
    
    this.isParticipating = false;
    this.updateBidButtonState();
    UTILS.vibrate('medium');
  }

  // Пользователь выиграл
  handleYouWon(data) {
    UI.showWin(data.prize);
    
    // Обновляем баланс пользователя
    this.userData.stars_balance += data.prize;
    this.userData.total_winnings = (this.userData.total_winnings || 0) + data.prize;
    UI.updateUserData(this.userData);
    
    this.isParticipating = false;
  }

  // Новая лотерея
  handleNewRaffle(data) {
    this.currentRaffle = data.raffle;
    this.currentSettings = data.settings;
    this.isParticipating = false;
    
    this.updateRaffleUI();
    this.updateBidButtonState();
    
    UI.showNotification('Началась новая лотерея!', CONFIG.NOTIFICATION_TYPES.INFO);
  }

  // === ДРУГИЕ ОБРАБОТЧИКИ ===

  // Обновление статистики пользователя
  handleUserStatsUpdate(data) {
    if (data.stars_balance !== undefined) {
      this.userData.stars_balance = data.stars_balance;
      UI.updateUserData(this.userData);
    }
  }

  // Ошибка транзакции
  handleTransactionError(data) {
    UI.showNotification(data.message || 'Ошибка транзакции', CONFIG.NOTIFICATION_TYPES.ERROR);
    this.updateBidButtonState();
  }

  // Уведомление о возврате
  handleRefundNotification(data) {
    UI.showNotification(
      `Возврат: ${UTILS.formatStars(data.amount)}. ${data.reason}`,
      CONFIG.NOTIFICATION_TYPES.INFO,
      5000
    );
    
    this.userData.stars_balance += data.amount;
    UI.updateUserData(this.userData);
  }

  // Сообщение от администратора
  handleAdminMessage(data) {
    UI.showNotification(
      `📢 ${data.message}`,
      CONFIG.NOTIFICATION_TYPES.WARNING,
      10000
    );
  }

  // Системное сообщение
  handleSystemMessage(data) {
    const type = {
      info: CONFIG.NOTIFICATION_TYPES.INFO,
      success: CONFIG.NOTIFICATION_TYPES.SUCCESS,
      warning: CONFIG.NOTIFICATION_TYPES.WARNING,
      error: CONFIG.NOTIFICATION_TYPES.ERROR
    }[data.type] || CONFIG.NOTIFICATION_TYPES.INFO;
    
    UI.showNotification(data.message, type, 8000);
  }

  // Уведомление о технических работах
  handleMaintenanceNotification(data) {
    UI.showNotification(
      `🔧 ${data.message} (${data.duration})`,
      CONFIG.NOTIFICATION_TYPES.WARNING,
      15000
    );
  }

  // Изменение сетевого подключения
  handleNetworkChange(isOnline) {
    if (isOnline) {
      UI.showNotification('Подключение восстановлено', CONFIG.NOTIFICATION_TYPES.SUCCESS);
      if (!this.state.isConnected) {
        this.connectWebSocket();
      }
    } else {
      UI.showNotification('Нет подключения к интернету', CONFIG.NOTIFICATION_TYPES.ERROR);
    }
  }

  // === ОБНОВЛЕНИЕ UI ===

  // Обновление интерфейса лотереи
  updateRaffleUI() {
    if (!this.currentRaffle || !this.currentSettings) return;
    
    UI.updateRaffleData(this.currentRaffle, this.currentSettings);
    this.updateBidButtonState();
  }

  // Обновление состояния кнопки ставки
  updateBidButtonState() {
    if (!this.currentSettings) {
      UI.updateBidButton('disabled', { reason: 'Загрузка...' });
      return;
    }

    if (this.isParticipating) {
      UI.updateBidButton('participating');
      UI.updateUserParticipation(true);
      return;
    }

    if (!this.state.isConnected) {
      UI.updateBidButton('disabled', { reason: 'Нет связи' });
      return;
    }

    if (!this.userData || this.userData.stars_balance < this.currentSettings.bid_amount) {
      UI.updateBidButton('disabled', { reason: 'Мало звезд' });
      return;
    }

    if (!this.currentRaffle || this.currentRaffle.status !== 'active') {
      UI.updateBidButton('disabled', { reason: 'Лотерея неактивна' });
      return;
    }

    if (this.currentRaffle.current_participants >= this.currentRaffle.required_participants) {
      UI.updateBidButton('disabled', { reason: 'Лотерея заполнена' });
      return;
    }

    UI.updateBidButton('ready');
    UI.updateUserParticipation(false);
  }

  // === ОБРАБОТКА ОШИБОК ===

  // Обработка ошибки инициализации
  handleInitError(error) {
    console.error('❌ Init error:', error);
    UI.showError(
      error.message || 'Ошибка инициализации приложения',
      () => this.handleRetryClick()
    );
  }

  // === ПУБЛИЧНЫЕ МЕТОДЫ ===

  // Получение состояния приложения
  getState() {
    return { ...this.state };
  }

  // Получение данных пользователя
  getUserData() {
    return this.userData ? { ...this.userData } : null;
  }

  // Получение текущей лотереи
  getCurrentRaffle() {
    return this.currentRaffle ? { ...this.currentRaffle } : null;
  }

  // Принудительное обновление данных
  async refresh() {
    try {
      await this.loadInitialData();
    } catch (error) {
      console.error('❌ Refresh error:', error);
      UI.showNotification('Ошибка обновления данных', CONFIG.NOTIFICATION_TYPES.ERROR);
    }
  }
}

// Инициализация приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Создаем экземпляр приложения
    window.APP = new RaffleApp();
    
    // Инициализируем приложение
    await APP.init();
    
    console.log('🎲 Telegram Raffle Stars app started successfully!');
  } catch (error) {
    console.error('❌ Failed to start app:', error);
  }
});

// Экспорт для других модулей
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RaffleApp;
}