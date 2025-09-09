// Конфигурация приложения
const CONFIG = {
  // API endpoints
  API_BASE: window.location.origin + '/api',
  WS_URL: window.location.origin,
  
  // Telegram WebApp
  TELEGRAM_WEB_APP: window.Telegram?.WebApp,
  
  // Настройки приложения
  NOTIFICATION_TIMEOUT: 5000, // 5 секунд
  HEARTBEAT_INTERVAL: 30000,   // 30 секунд
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 2000,       // 2 секунды
  
  // Анимации
  ANIMATION_DURATION: 300,
  
  // Локальные ключи для хранения
  STORAGE_KEYS: {
    AUTH_TOKEN: 'raffle_auth_token',
    USER_DATA: 'raffle_user_data',
    SETTINGS: 'raffle_settings'
  },
  
  // События WebSocket
  SOCKET_EVENTS: {
    AUTHENTICATE: 'authenticate',
    AUTHENTICATED: 'authenticated',
    AUTH_ERROR: 'auth_error',
    RAFFLE_UPDATE: 'raffle_update',
    NEW_BID: 'new_bid',
    RAFFLE_COMPLETED: 'raffle_completed',
    YOU_WON: 'you_won',
    NEW_RAFFLE: 'new_raffle',
    USER_STATS_UPDATE: 'user_stats_update',
    TRANSACTION_ERROR: 'transaction_error',
    REFUND_NOTIFICATION: 'refund_notification',
    ADMIN_MESSAGE: 'admin_message',
    SYSTEM_MESSAGE: 'system_message',
    MAINTENANCE_NOTIFICATION: 'maintenance_notification',
    GET_RAFFLE_STATUS: 'get_raffle_status',
    GET_GLOBAL_STATS: 'get_global_stats',
    GET_RECENT_WINNERS: 'get_recent_winners'
  },
  
  // Типы уведомлений
  NOTIFICATION_TYPES: {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
  },
  
  // Статусы лотереи
  RAFFLE_STATUS: {
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },
  
  // Статусы подключения
  CONNECTION_STATUS: {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting'
  },
  
  // Тексты интерфейса
  TEXTS: {
    LOADING: 'Загрузка...',
    CONNECTING: 'Подключение...',
    CONNECTED: 'Подключено',
    DISCONNECTED: 'Нет подключения',
    RECONNECTING: 'Переподключение...',
    BID_BUTTON_DEFAULT: 'СТАВКА',
    BID_BUTTON_PARTICIPATING: 'УЧАСТВУЕТЕ',
    BID_BUTTON_LOADING: 'ОЖИДАНИЕ...',
    BID_BUTTON_DISABLED: 'НЕДОСТУПНО',
    WAITING_PARTICIPANTS: 'Ожидаем участников...',
    RAFFLE_STARTING: 'Лотерея начинается!',
    RAFFLE_COMPLETED: 'Лотерея завершена!',
    NO_WINNERS: 'Пока нет победителей',
    INSUFFICIENT_STARS: 'Недостаточно звезд',
    ALREADY_PARTICIPATING: 'Вы уже участвуете',
    TRANSACTION_PROCESSING: 'Обработка транзакции...',
    CONGRATULATIONS: 'Поздравляем!',
    YOU_WON: 'Вы выиграли!',
    PRIZE_CREDITED: 'Приз зачислен на счет',
    TRY_AGAIN: 'Попробовать снова',
    CONTINUE: 'Продолжить'
  },
  
  // Эмодзи для интерфейса
  EMOJI: {
    STAR: '⭐',
    TROPHY: '🏆',
    PARTY: '🎉',
    MONEY: '💰',
    FIRE: '🔥',
    CROWN: '👑',
    DIAMOND: '💎',
    ROCKET: '🚀',
    WARNING: '⚠️',
    CHECK: '✅',
    CROSS: '❌',
    LOADING: '⏳'
  }
};

// Функции утилиты
const UTILS = {
  // Форматирование чисел
  formatNumber: (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  },
  
  // Форматирование звезд
  formatStars: (amount) => {
    return `${UTILS.formatNumber(amount)} ${CONFIG.EMOJI.STAR}`;
  },
  
  // Форматирование времени
  formatTime: (date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}д назад`;
    if (hours > 0) return `${hours}ч назад`;
    if (minutes > 0) return `${minutes}м назад`;
    return 'только что';
  },
  
  // Получение имени пользователя
  getUserDisplayName: (user) => {
    if (!user) return 'Anonymous';
    return user.first_name || user.username || 'User';
  },
  
  // Получение первой буквы имени для аватара
  getUserAvatar: (user) => {
    const name = UTILS.getUserDisplayName(user);
    return name.charAt(0).toUpperCase();
  },
  
  // Проверка валидности токена
  isTokenValid: (token) => {
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp > Date.now() / 1000;
    } catch {
      return false;
    }
  },
  
  // Локальное хранение
  storage: {
    get: (key) => {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch {
        return null;
      }
    },
    
    set: (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    
    remove: (key) => {
      try {
        localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    }
  },
  
  // Вибрация (для Telegram WebApp)
  vibrate: (type = 'light') => {
    if (CONFIG.TELEGRAM_WEB_APP && CONFIG.TELEGRAM_WEB_APP.HapticFeedback) {
      CONFIG.TELEGRAM_WEB_APP.HapticFeedback.impactOccurred(type);
    }
  },
  
  // Создание задержки
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Безопасное выполнение функции
  safeExecute: async (fn, fallback = null) => {
    try {
      return await fn();
    } catch (error) {
      console.error('Safe execute error:', error);
      return fallback;
    }
  },
  
  // Проверка подключения к интернету
  isOnline: () => navigator.onLine,
  
  // Генерация уникального ID
  generateId: () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },
  
  // Анимация счетчика
  animateNumber: (element, from, to, duration = 1000) => {
    const start = performance.now();
    const range = to - from;
    
    const update = (current) => {
      const elapsed = current - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current_value = Math.round(from + range * easeOut);
      
      element.textContent = current_value;
      
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };
    
    requestAnimationFrame(update);
  },
  
  // Проверка поддержки WebGL (для эффектов)
  hasWebGL: () => {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  }
};

// Экспорт для других модулей
window.CONFIG = CONFIG;
window.UTILS = UTILS;