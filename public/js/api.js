// API клиент для взаимодействия с сервером
class ApiClient {
  constructor() {
    this.baseURL = CONFIG.API_BASE;
    this.token = UTILS.storage.get(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    this.isRefreshing = false;
    this.failedQueue = [];
  }

  // Получение заголовков для запроса
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  // Обработка ответа
  async handleResponse(response) {
    if (response.ok) {
      return await response.json();
    }

    const errorData = await response.json().catch(() => ({}));
    
    // Если токен истек, пробуем обновить
    if (response.status === 401 && !this.isRefreshing) {
      return await this.handleTokenRefresh();
    }

    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  // Обновление токена
  async handleTokenRefresh() {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;

    try {
      // Пробуем повторно аутентифицироваться через Telegram
      const telegramUser = this.getTelegramUser();
      if (telegramUser) {
        const authResult = await this.authenticateWithTelegram(telegramUser);
        this.token = authResult.token;
        UTILS.storage.set(CONFIG.STORAGE_KEYS.AUTH_TOKEN, this.token);
        
        // Выполняем отложенные запросы
        this.failedQueue.forEach(({ resolve }) => resolve());
        this.failedQueue = [];
        
        return authResult;
      }
    } catch (error) {
      // Очищаем токен при ошибке
      this.token = null;
      UTILS.storage.remove(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
      
      this.failedQueue.forEach(({ reject }) => reject(error));
      this.failedQueue = [];
      
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  // Получение пользователя из Telegram WebApp
  getTelegramUser() {
    if (!CONFIG.TELEGRAM_WEB_APP) return null;
    
    const initData = CONFIG.TELEGRAM_WEB_APP.initData;
    const user = CONFIG.TELEGRAM_WEB_APP.initDataUnsafe?.user;
    
    if (!user || !user.id) return null;
    
    return { initData, user };
  }

  // Выполнение HTTP запроса
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: this.getHeaders(),
      ...options,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      return await this.handleResponse(response);
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  // GET запрос
  async get(endpoint, params = {}) {
    const url = new URL(`${this.baseURL}${endpoint}`);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined) {
        url.searchParams.append(key, params[key]);
      }
    });

    return await this.request(url.pathname + url.search, {
      method: 'GET',
    });
  }

  // POST запрос
  async post(endpoint, data = {}) {
    return await this.request(endpoint, {
      method: 'POST',
      body: data,
    });
  }

  // PUT запрос
  async put(endpoint, data = {}) {
    return await this.request(endpoint, {
      method: 'PUT',
      body: data,
    });
  }

  // DELETE запрос
  async delete(endpoint) {
    return await this.request(endpoint, {
      method: 'DELETE',
    });
  }

  // === AUTH ENDPOINTS ===

  // Аутентификация через Telegram
  async authenticateWithTelegram(telegramData) {
    const response = await this.post('/auth/telegram', telegramData);
    
    if (response.success && response.token) {
      this.token = response.token;
      UTILS.storage.set(CONFIG.STORAGE_KEYS.AUTH_TOKEN, response.token);
      UTILS.storage.set(CONFIG.STORAGE_KEYS.USER_DATA, response.user);
    }
    
    return response;
  }

  // Обновление токена
  async refreshAuth(userData) {
    const response = await this.put('/auth/refresh', { user: userData });
    
    if (response.success && response.user) {
      UTILS.storage.set(CONFIG.STORAGE_KEYS.USER_DATA, response.user);
    }
    
    return response;
  }

  // Проверка валидности токена
  async verifyToken() {
    return await this.get('/auth/verify');
  }

  // Выход
  async logout() {
    const response = await this.post('/auth/logout');
    this.token = null;
    UTILS.storage.remove(CONFIG.STORAGE_KEYS.AUTH_TOKEN);
    UTILS.storage.remove(CONFIG.STORAGE_KEYS.USER_DATA);
    return response;
  }

  // === USER ENDPOINTS ===

  // Получение профиля пользователя
  async getUserProfile() {
    return await this.get('/user/profile');
  }

  // Обновление профиля
  async updateUserProfile(profileData) {
    return await this.put('/user/profile', profileData);
  }

  // Получение баланса звезд
  async getUserBalance() {
    return await this.get('/user/balance');
  }

  // Получение статистики пользователя
  async getUserStats() {
    return await this.get('/user/stats');
  }

  // Получение истории транзакций
  async getUserTransactions(page = 1, limit = 20, type = null) {
    return await this.get('/user/transactions', { page, limit, type });
  }

  // Получение топ победителей
  async getTopWinners(limit = 10) {
    return await this.get('/user/top-winners', { limit });
  }

  // === RAFFLE ENDPOINTS ===

  // Получение текущей лотереи
  async getCurrentRaffle() {
    return await this.get('/raffle/current');
  }

  // Сделать ставку
  async placeBid(amount, transactionId) {
    return await this.post('/raffle/bid', {
      amount,
      transaction_id: transactionId
    });
  }

  // Получение статуса лотереи
  async getRaffleStatus() {
    return await this.get('/raffle/status');
  }

  // Получение истории лотерей
  async getRaffleHistory(limit = 20, page = 1) {
    return await this.get('/raffle/history', { limit, page });
  }

  // Получение детальной информации о лотерее
  async getRaffleDetails(raffleId) {
    return await this.get(`/raffle/${raffleId}`);
  }

  // Проверка результатов лотереи
  async verifyRaffle(raffleId) {
    return await this.get(`/raffle/${raffleId}/verify`);
  }

  // === STATS ENDPOINTS ===

  // Глобальная статистика
  async getGlobalStats() {
    return await this.get('/stats/global');
  }

  // Статистика лотерей
  async getRaffleStats(period = '7d') {
    return await this.get('/stats/raffles', { period });
  }

  // Статистика пользователей
  async getUsersStats() {
    return await this.get('/stats/users');
  }

  // Статистика подключений
  async getConnectionStats() {
    return await this.get('/stats/connections');
  }

  // === UTILITY METHODS ===

  // Создание инвойса для оплаты (через Telegram Stars)
  async createPaymentInvoice(amount, description) {
    // В реальной реализации этот метод будет работать с Telegram Stars API
    // Пока возвращаем мок-данные для разработки
    return {
      success: true,
      invoice_id: `inv_${Date.now()}`,
      amount: amount,
      description: description,
      payment_url: `tg://invoice/mock_${amount}`
    };
  }

  // Проверка статуса платежа
  async checkPaymentStatus(transactionId) {
    // Мок-реализация для разработки
    return {
      success: true,
      transaction_id: transactionId,
      status: 'completed',
      amount: 1
    };
  }

  // Проверка состояния сервера
  async getHealthStatus() {
    return await this.get('/health');
  }

  // === ERROR HANDLING ===

  // Обработка ошибок сети
  handleNetworkError(error) {
    if (!navigator.onLine) {
      return new Error('Нет подключения к интернету');
    }
    return error;
  }

  // Повторная попытка запроса
  async retryRequest(requestFn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = this.handleNetworkError(error);
        if (i < maxRetries - 1) {
          await UTILS.delay(delay * Math.pow(2, i)); // Экспоненциальная задержка
        }
      }
    }
    
    throw lastError;
  }
}

// Создание глобального экземпляра API клиента
window.API = new ApiClient();

// Экспорт для других модулей
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiClient;
}