// Управление пользовательским интерфейсом
class UIManager {
  constructor() {
    this.elements = {};
    this.screens = {};
    this.notifications = new Map();
    this.currentScreen = null;
    this.animationQueue = [];
    this.isAnimating = false;
    
    this.initElements();
    this.bindEvents();
  }

  // Инициализация элементов DOM
  initElements() {
    // Основные экраны
    this.screens = {
      loading: document.getElementById('loading'),
      main: document.getElementById('main-screen'),
      win: document.getElementById('win-screen'),
      error: document.getElementById('error-screen')
    };

    // Элементы основного экрана
    this.elements = {
      // Статистика вверху
      userStars: document.getElementById('user-stars'),
      requiredParticipants: document.getElementById('required-participants'),
      currentParticipants: document.getElementById('current-participants'),
      
      // Прогресс
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      progressText: document.getElementById('progress-text'),
      
      // Кнопка ставки
      bidButton: document.getElementById('bid-button'),
      bidAmount: document.getElementById('bid-amount'),
      
      // Информационная панель
      totalUsers: document.getElementById('total-users'),
      totalPrize: document.getElementById('total-prize'),
      userParticipation: document.getElementById('user-participation'),
      
      // Победители
      recentWinners: document.getElementById('recent-winners'),
      
      // Экран победы
      winAmount: document.getElementById('win-amount'),
      continueButton: document.getElementById('continue-button'),
      
      // Экран ошибки
      errorMessage: document.getElementById('error-message'),
      retryButton: document.getElementById('retry-button'),
      
      // Уведомления
      notifications: document.getElementById('notifications')
    };
  }

  // Привязка событий
  bindEvents() {
    // Кнопка ставки
    if (this.elements.bidButton) {
      this.elements.bidButton.addEventListener('click', () => {
        this.emit('bid_clicked');
      });
    }

    // Кнопка продолжения
    if (this.elements.continueButton) {
      this.elements.continueButton.addEventListener('click', () => {
        this.hideScreen('win');
        this.showScreen('main');
      });
    }

    // Кнопка повтора
    if (this.elements.retryButton) {
      this.elements.retryButton.addEventListener('click', () => {
        this.emit('retry_clicked');
        this.hideScreen('error');
      });
    }

    // Обработка событий Telegram WebApp
    if (CONFIG.TELEGRAM_WEB_APP) {
      CONFIG.TELEGRAM_WEB_APP.onEvent('mainButtonClicked', () => {
        this.emit('main_button_clicked');
      });
    }
  }

  // === УПРАВЛЕНИЕ ЭКРАНАМИ ===

  // Показать экран
  showScreen(screenName) {
    if (!this.screens[screenName]) {
      console.error('Screen not found:', screenName);
      return;
    }

    // Скрываем все другие экраны
    Object.keys(this.screens).forEach(name => {
      if (name !== screenName) {
        this.screens[name].classList.add('hidden');
      }
    });

    // Показываем нужный экран
    this.screens[screenName].classList.remove('hidden');
    this.currentScreen = screenName;

    console.log(`🖥️ Screen changed to: ${screenName}`);
  }

  // Скрыть экран
  hideScreen(screenName) {
    if (this.screens[screenName]) {
      this.screens[screenName].classList.add('hidden');
    }
  }

  // Показать экран загрузки
  showLoading(message = CONFIG.TEXTS.LOADING) {
    this.showScreen('loading');
    const loadingText = document.querySelector('.loading-screen p');
    if (loadingText) {
      loadingText.textContent = message;
    }
  }

  // Показать экран ошибки
  showError(message, retryCallback = null) {
    this.elements.errorMessage.textContent = message;
    this.showScreen('error');
    
    if (retryCallback) {
      this.off('retry_clicked'); // Удаляем старый обработчик
      this.on('retry_clicked', retryCallback);
    }
  }

  // Показать экран победы
  showWin(amount) {
    this.elements.winAmount.textContent = UTILS.formatStars(amount);
    this.showScreen('win');
    
    // Добавляем эффекты
    UTILS.vibrate('heavy');
    this.addConfetti();
  }

  // === ОБНОВЛЕНИЕ ДАННЫХ ===

  // Обновление пользовательских данных
  updateUserData(userData) {
    if (userData.stars_balance !== undefined) {
      this.updateUserStars(userData.stars_balance);
    }
  }

  // Обновление звезд пользователя
  updateUserStars(amount) {
    const currentAmount = parseInt(this.elements.userStars.textContent.replace(/[^\d]/g, '')) || 0;
    
    if (currentAmount !== amount) {
      UTILS.animateNumber(
        this.elements.userStars, 
        currentAmount, 
        amount,
        1000
      );
      
      // Обновляем текст с эмодзи
      setTimeout(() => {
        this.elements.userStars.textContent = UTILS.formatStars(amount);
      }, 1000);
    }
  }

  // Обновление данных лотереи
  updateRaffleData(raffleData, settingsData) {
    if (!raffleData || !settingsData) return;

    // Обновляем количество участников
    this.updateParticipants(
      raffleData.current_participants || 0,
      raffleData.required_participants || settingsData.required_participants || 10
    );

    // Обновляем сумму ставки
    this.updateBidAmount(settingsData.bid_amount || 1);

    // Обновляем общий банк
    this.updateTotalPrize(raffleData.total_prize || 0);

    // Обновляем прогресс
    this.updateProgress(
      raffleData.current_participants || 0,
      raffleData.required_participants || settingsData.required_participants || 10
    );
  }

  // Обновление участников
  updateParticipants(current, required) {
    // Обновляем текущих участников
    const currentElement = this.elements.currentParticipants;
    const currentValue = parseInt(currentElement.textContent) || 0;
    
    if (currentValue !== current) {
      UTILS.animateNumber(currentElement, currentValue, current, 500);
    }

    // Обновляем требуемых участников
    this.elements.requiredParticipants.textContent = required.toString();
  }

  // Обновление суммы ставки
  updateBidAmount(amount) {
    this.elements.bidAmount.textContent = UTILS.formatStars(amount);
  }

  // Обновление общего банка
  updateTotalPrize(amount) {
    const currentAmount = parseInt(this.elements.totalPrize.textContent.replace(/[^\d]/g, '')) || 0;
    
    if (currentAmount !== amount) {
      UTILS.animateNumber(
        this.elements.totalPrize,
        currentAmount,
        amount,
        500
      );
      
      setTimeout(() => {
        this.elements.totalPrize.textContent = UTILS.formatStars(amount);
      }, 500);
    }
  }

  // Обновление прогресса
  updateProgress(current, required) {
    const percentage = Math.min((current / required) * 100, 100);
    
    this.elements.progressFill.style.width = `${percentage}%`;
    
    if (current >= required) {
      this.elements.progressText.textContent = CONFIG.TEXTS.RAFFLE_STARTING;
      this.elements.progressFill.classList.add('completed');
    } else {
      this.elements.progressText.textContent = 
        `${current}/${required} участников`;
      this.elements.progressFill.classList.remove('completed');
    }
  }

  // === УПРАВЛЕНИЕ КНОПКОЙ СТАВКИ ===

  // Обновление состояния кнопки ставки
  updateBidButton(state, data = {}) {
    const button = this.elements.bidButton;
    const bidText = button.querySelector('.bid-text');
    
    // Удаляем все классы состояний
    button.classList.remove('ready', 'participating', 'disabled', 'loading');
    
    switch (state) {
      case 'ready':
        button.disabled = false;
        button.classList.add('ready');
        bidText.textContent = CONFIG.TEXTS.BID_BUTTON_DEFAULT;
        break;
        
      case 'participating':
        button.disabled = true;
        button.classList.add('participating');
        bidText.textContent = CONFIG.TEXTS.BID_BUTTON_PARTICIPATING;
        break;
        
      case 'loading':
        button.disabled = true;
        button.classList.add('loading');
        bidText.textContent = CONFIG.TEXTS.BID_BUTTON_LOADING;
        break;
        
      case 'disabled':
      default:
        button.disabled = true;
        button.classList.add('disabled');
        bidText.textContent = data.reason || CONFIG.TEXTS.BID_BUTTON_DISABLED;
        break;
    }
  }

  // === УПРАВЛЕНИЕ СТАТИСТИКОЙ ===

  // Обновление общей статистики
  updateGlobalStats(stats) {
    if (stats.total_users !== undefined) {
      this.elements.totalUsers.textContent = UTILS.formatNumber(stats.total_users);
    }
  }

  // Обновление статуса участия пользователя
  updateUserParticipation(isParticipating) {
    this.elements.userParticipation.textContent = 
      isParticipating ? 'Да' : 'Нет';
    
    if (isParticipating) {
      this.elements.userParticipation.style.color = 'var(--success-color)';
    } else {
      this.elements.userParticipation.style.color = 'var(--text-muted)';
    }
  }

  // === УПРАВЛЕНИЕ ПОБЕДИТЕЛЯМИ ===

  // Обновление списка недавних победителей
  updateRecentWinners(winners) {
    const container = this.elements.recentWinners;
    
    if (!winners || winners.length === 0) {
      container.innerHTML = `
        <div class="no-winners">
          ${CONFIG.TEXTS.NO_WINNERS}
        </div>
      `;
      return;
    }

    const winnersHtml = winners.map(winner => `
      <div class="winner-item">
        <div class="winner-info">
          <div class="winner-avatar">
            ${UTILS.getUserAvatar(winner.winner_info)}
          </div>
          <div class="winner-name">
            ${UTILS.getUserDisplayName(winner.winner_info)}
          </div>
        </div>
        <div class="winner-prize">
          ${UTILS.formatStars(winner.prize)}
        </div>
      </div>
    `).join('');
    
    container.innerHTML = winnersHtml;
  }

  // === УВЕДОМЛЕНИЯ ===

  // Показать уведомление
  showNotification(message, type = CONFIG.NOTIFICATION_TYPES.INFO, duration = CONFIG.NOTIFICATION_TIMEOUT) {
    const id = UTILS.generateId();
    const notification = this.createNotificationElement(id, message, type);
    
    this.elements.notifications.appendChild(notification);
    this.notifications.set(id, { element: notification, timeout: null });

    // Анимация появления
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });

    // Автоматическое скрытие
    if (duration > 0) {
      const timeout = setTimeout(() => {
        this.hideNotification(id);
      }, duration);
      
      this.notifications.get(id).timeout = timeout;
    }

    return id;
  }

  // Создание элемента уведомления
  createNotificationElement(id, message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.dataset.id = id;
    
    notification.innerHTML = `
      <div class="notification-content">
        <div class="notification-message">${message}</div>
        <button class="notification-close">&times;</button>
      </div>
    `;

    // Обработчик закрытия
    const closeButton = notification.querySelector('.notification-close');
    closeButton.addEventListener('click', () => {
      this.hideNotification(id);
    });

    return notification;
  }

  // Скрыть уведомление
  hideNotification(id) {
    const notification = this.notifications.get(id);
    if (!notification) return;

    // Очищаем таймаут
    if (notification.timeout) {
      clearTimeout(notification.timeout);
    }

    // Анимация скрытия
    notification.element.classList.add('hiding');
    
    setTimeout(() => {
      if (notification.element.parentNode) {
        notification.element.parentNode.removeChild(notification.element);
      }
      this.notifications.delete(id);
    }, 300);
  }

  // Скрыть все уведомления
  clearNotifications() {
    this.notifications.forEach((_, id) => {
      this.hideNotification(id);
    });
  }

  // === ЭФФЕКТЫ ===

  // Добавление конфетти при выигрыше
  addConfetti() {
    // Простая реализация конфетти
    const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];
    const container = document.body;
    
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
          position: fixed;
          width: 10px;
          height: 10px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          left: ${Math.random() * 100}vw;
          top: -10px;
          opacity: 1;
          border-radius: 50%;
          animation: confetti-fall 3s linear forwards;
          pointer-events: none;
          z-index: 10000;
        `;
        
        container.appendChild(confetti);
        
        setTimeout(() => {
          if (confetti.parentNode) {
            confetti.parentNode.removeChild(confetti);
          }
        }, 3000);
      }, i * 50);
    }
  }

  // === СОБЫТИЯ ===

  // Подписка на события
  on(event, callback) {
    if (!this.eventListeners) {
      this.eventListeners = new Map();
    }
    
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    
    this.eventListeners.get(event).add(callback);
  }

  // Отписка от событий
  off(event, callback = null) {
    if (!this.eventListeners?.has(event)) return;
    
    if (callback) {
      this.eventListeners.get(event).delete(callback);
    } else {
      this.eventListeners.get(event).clear();
    }
  }

  // Эмитирование событий
  emit(event, data) {
    if (!this.eventListeners?.has(event)) return;
    
    this.eventListeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('UI event callback error:', error);
      }
    });
  }

  // === УТИЛИТЫ ===

  // Обновление заголовка Telegram WebApp
  updateTelegramTitle(title) {
    if (CONFIG.TELEGRAM_WEB_APP) {
      CONFIG.TELEGRAM_WEB_APP.MainButton.text = title;
    }
  }

  // Установка цвета темы
  setThemeColor(color) {
    if (CONFIG.TELEGRAM_WEB_APP) {
      CONFIG.TELEGRAM_WEB_APP.setBackgroundColor(color);
    }
  }

  // Получение текущего экрана
  getCurrentScreen() {
    return this.currentScreen;
  }

  // Проверка видимости элемента
  isElementVisible(element) {
    if (!element) return false;
    return !element.classList.contains('hidden');
  }
}

// Добавляем CSS анимацию для конфетти
const style = document.createElement('style');
style.textContent = `
  @keyframes confetti-fall {
    0% {
      transform: translateY(-100vh) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(100vh) rotate(720deg);
      opacity: 0;
    }
  }
  
  .notification {
    transform: translateX(100%);
    transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    opacity: 0;
  }
  
  .notification.show {
    transform: translateX(0);
    opacity: 1;
  }
  
  .notification.hiding {
    transform: translateX(100%);
    opacity: 0;
  }
`;
document.head.appendChild(style);

// Создание глобального экземпляра UI Manager
window.UI = new UIManager();

// Экспорт для других модулей
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIManager;
}