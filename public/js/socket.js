// WebSocket клиент для связи в реальном времени
class SocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = CONFIG.RECONNECT_ATTEMPTS;
    this.reconnectDelay = CONFIG.RECONNECT_DELAY;
    this.heartbeatInterval = null;
    this.connectionStatus = CONFIG.CONNECTION_STATUS.DISCONNECTED;
    this.eventListeners = new Map();
    this.messageQueue = [];
    this.autoReconnect = true;
  }

  // Подключение к серверу
  connect() {
    if (this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        this.connectionStatus = CONFIG.CONNECTION_STATUS.CONNECTING;
        this.emit('status_changed', this.connectionStatus);

        this.socket = io(CONFIG.WS_URL, {
          transports: ['websocket', 'polling'],
          upgrade: true,
          rememberUpgrade: true,
          timeout: 10000,
          forceNew: true
        });

        // Обработчики событий подключения
        this.socket.on('connect', () => {
          console.log('✅ WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.connectionStatus = CONFIG.CONNECTION_STATUS.CONNECTED;
          this.emit('status_changed', this.connectionStatus);
          
          this.setupHeartbeat();
          this.authenticate();
          this.processMessageQueue();
          
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          console.log('🔌 WebSocket disconnected:', reason);
          this.isConnected = false;
          this.connectionStatus = CONFIG.CONNECTION_STATUS.DISCONNECTED;
          this.emit('status_changed', this.connectionStatus);
          
          this.clearHeartbeat();
          
          if (this.autoReconnect && reason !== 'io client disconnect') {
            this.scheduleReconnect();
          }
        });

        this.socket.on('connect_error', (error) => {
          console.error('❌ WebSocket connection error:', error);
          this.connectionStatus = CONFIG.CONNECTION_STATUS.DISCONNECTED;
          this.emit('status_changed', this.connectionStatus);
          
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
          
          this.scheduleReconnect();
        });

        // Настройка обработчиков событий приложения
        this.setupEventHandlers();

      } catch (error) {
        console.error('❌ Socket connection failed:', error);
        reject(error);
      }
    });
  }

  // Отключение
  disconnect() {
    this.autoReconnect = false;
    this.clearHeartbeat();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.isConnected = false;
    this.connectionStatus = CONFIG.CONNECTION_STATUS.DISCONNECTED;
    this.emit('status_changed', this.connectionStatus);
  }

  // Аутентификация пользователя
  authenticate() {
    const userData = UTILS.storage.get(CONFIG.STORAGE_KEYS.USER_DATA);
    const token = UTILS.storage.get(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    
    if (userData && token && UTILS.isTokenValid(token)) {
      const authData = {
        telegram_id: userData.telegram_id,
        username: userData.username || 'Anonymous'
      };
      
      this.send(CONFIG.SOCKET_EVENTS.AUTHENTICATE, authData);
    }
  }

  // Повторное подключение
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnect attempts reached');
      this.emit('max_reconnects_reached');
      return;
    }

    this.reconnectAttempts++;
    this.connectionStatus = CONFIG.CONNECTION_STATUS.RECONNECTING;
    this.emit('status_changed', this.connectionStatus);

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.autoReconnect) {
        this.connect().catch(() => {
          // Ошибка обрабатывается в connect_error
        });
      }
    }, delay);
  }

  // Отправка сообщения
  send(event, data = {}) {
    if (!this.isConnected || !this.socket) {
      // Добавляем в очередь если не подключены
      this.messageQueue.push({ event, data });
      return false;
    }

    try {
      this.socket.emit(event, data);
      return true;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      return false;
    }
  }

  // Обработка очереди сообщений
  processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message.event, message.data);
    }
  }

  // Подписка на событие
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(callback);
  }

  // Отписка от события
  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  // Эмитирование локального события
  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('❌ Event listener error:', error);
        }
      });
    }
  }

  // Настройка обработчиков событий сервера
  setupEventHandlers() {
    if (!this.socket) return;

    // Аутентификация
    this.socket.on(CONFIG.SOCKET_EVENTS.AUTHENTICATED, (data) => {
      console.log('✅ WebSocket authenticated:', data);
      this.emit('authenticated', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.AUTH_ERROR, (error) => {
      console.error('❌ WebSocket auth error:', error);
      this.emit('auth_error', error);
    });

    // События лотереи
    this.socket.on(CONFIG.SOCKET_EVENTS.RAFFLE_UPDATE, (data) => {
      console.log('📡 Raffle update received:', data);
      this.emit('raffle_update', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.NEW_BID, (data) => {
      console.log('📡 New bid received:', data);
      this.emit('new_bid', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.RAFFLE_COMPLETED, (data) => {
      console.log('📡 Raffle completed:', data);
      this.emit('raffle_completed', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.YOU_WON, (data) => {
      console.log('🎉 You won!', data);
      this.emit('you_won', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.NEW_RAFFLE, (data) => {
      console.log('📡 New raffle started:', data);
      this.emit('new_raffle', data);
    });

    // Пользовательские события
    this.socket.on(CONFIG.SOCKET_EVENTS.USER_STATS_UPDATE, (data) => {
      console.log('📡 User stats updated:', data);
      this.emit('user_stats_update', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.TRANSACTION_ERROR, (data) => {
      console.error('📡 Transaction error:', data);
      this.emit('transaction_error', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.REFUND_NOTIFICATION, (data) => {
      console.log('📡 Refund notification:', data);
      this.emit('refund_notification', data);
    });

    // Административные сообщения
    this.socket.on(CONFIG.SOCKET_EVENTS.ADMIN_MESSAGE, (data) => {
      console.log('📡 Admin message:', data);
      this.emit('admin_message', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.SYSTEM_MESSAGE, (data) => {
      console.log('📡 System message:', data);
      this.emit('system_message', data);
    });

    this.socket.on(CONFIG.SOCKET_EVENTS.MAINTENANCE_NOTIFICATION, (data) => {
      console.log('📡 Maintenance notification:', data);
      this.emit('maintenance_notification', data);
    });

    // Общие события
    this.socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
      this.emit('socket_error', error);
    });

    this.socket.on('pong', () => {
      this.emit('pong');
    });
  }

  // Запрос текущего состояния
  requestRaffleStatus() {
    this.send(CONFIG.SOCKET_EVENTS.GET_RAFFLE_STATUS);
  }

  requestGlobalStats() {
    this.send(CONFIG.SOCKET_EVENTS.GET_GLOBAL_STATS);
  }

  requestRecentWinners() {
    this.send(CONFIG.SOCKET_EVENTS.GET_RECENT_WINNERS);
  }

  // Настройка heartbeat
  setupHeartbeat() {
    this.clearHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.socket) {
        this.socket.emit('ping');
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  // Очистка heartbeat
  clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Получение статуса подключения
  getConnectionStatus() {
    return {
      status: this.connectionStatus,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      queueLength: this.messageQueue.length
    };
  }

  // Получение статистики соединения
  getConnectionStats() {
    if (!this.socket) {
      return null;
    }

    return {
      id: this.socket.id,
      transport: this.socket.io.engine.transport.name,
      upgraded: this.socket.io.engine.upgraded,
      readyState: this.socket.io.engine.readyState,
      ping: this.socket.io.engine.ping || 0
    };
  }

  // Установка опций переподключения
  setReconnectOptions(maxAttempts, delay) {
    this.maxReconnectAttempts = maxAttempts;
    this.reconnectDelay = delay;
  }

  // Включение/выключение автоматического переподключения
  setAutoReconnect(enabled) {
    this.autoReconnect = enabled;
  }

  // Очистка всех слушателей
  removeAllListeners() {
    this.eventListeners.clear();
  }
}

// Создание глобального экземпляра Socket клиента
window.SOCKET = new SocketClient();

// Экспорт для других модулей
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SocketClient;
}