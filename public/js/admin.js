// Админ панель для Telegram Raffle Stars
class AdminPanel {
  constructor() {
    this.apiBase = '/api/admin';
    this.token = localStorage.getItem('admin_token');
    this.isAuthenticated = false;
    this.refreshInterval = null;
    
    this.init();
  }

  // Инициализация панели
  async init() {
    console.log('🔧 Initializing Admin Panel...');
    
    // Проверяем существующий токен
    if (this.token) {
      try {
        await this.verifyToken();
        this.showAdminPanel();
      } catch (error) {
        console.log('Token verification failed, showing login');
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
    
    this.setupEventHandlers();
    this.updateConnectionStatus('disconnected');
  }

  // === АУТЕНТИФИКАЦИЯ ===

  // Показать форму входа
  showLogin() {
    document.getElementById('login-screen').classList.remove('d-none');
    document.getElementById('admin-panel').classList.add('d-none');
  }

  // Показать админ панель
  showAdminPanel() {
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('admin-panel').classList.remove('d-none');
    this.isAuthenticated = true;
    this.loadDashboard();
    this.startAutoRefresh();
  }

  // Вход в систему
  async login(username, password) {
    try {
      const response = await fetch(`${this.apiBase}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (data.success) {
        this.token = data.token;
        localStorage.setItem('admin_token', this.token);
        this.showAdminPanel();
        this.showAlert('success', 'Вход выполнен успешно');
      } else {
        throw new Error(data.message || 'Ошибка входа');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showLoginError(error.message);
      throw error;
    }
  }

  // Проверка токена
  async verifyToken() {
    const response = await this.makeRequest('GET', '/system');
    if (!response.success) {
      throw new Error('Token verification failed');
    }
  }

  // Выход
  logout() {
    this.token = null;
    localStorage.removeItem('admin_token');
    this.isAuthenticated = false;
    this.stopAutoRefresh();
    this.showLogin();
  }

  // === HTTP ЗАПРОСЫ ===

  // Выполнение запроса с аутентификацией
  async makeRequest(method, endpoint, data = null) {
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.apiBase}${endpoint}`, config);
      const result = await response.json();
      
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.logout();
          throw new Error('Сессия истекла');
        }
        throw new Error(result.message || `HTTP ${response.status}`);
      }
      
      return result;
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  // === ОБРАБОТЧИКИ СОБЫТИЙ ===

  setupEventHandlers() {
    // Форма входа
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const btnText = submitBtn.querySelector('.btn-text');
      const spinner = submitBtn.querySelector('.spinner-border');
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      try {
        btnText.textContent = 'Вход...';
        spinner.classList.remove('d-none');
        submitBtn.disabled = true;
        
        await this.login(username, password);
      } catch (error) {
        // Ошибка уже обработана в login()
      } finally {
        btnText.textContent = 'Войти';
        spinner.classList.add('d-none');
        submitBtn.disabled = false;
      }
    });

    // Кнопка выхода
    document.getElementById('logout-btn').addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Вы уверены, что хотите выйти?')) {
        this.logout();
      }
    });

    // Обновление дашборда
    document.getElementById('refresh-dashboard')?.addEventListener('click', () => {
      this.loadDashboard();
    });

    // Настройки лотереи
    document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveSettings();
    });

    // Создание лотереи
    document.getElementById('create-raffle-btn')?.addEventListener('click', async () => {
      await this.createRaffle();
    });

    // Обновление лотерей
    document.getElementById('refresh-raffles')?.addEventListener('click', () => {
      this.loadRaffles();
    });

    // Фильтр лотерей
    document.getElementById('raffle-status-filter')?.addEventListener('change', () => {
      this.loadRaffles();
    });

    // Обработчик переключения вкладок
    document.querySelectorAll('#admin-tabs .nav-link').forEach(tab => {
      tab.addEventListener('shown.bs.tab', (e) => {
        const targetTab = e.target.getAttribute('href').substring(1);
        this.handleTabChange(targetTab);
      });
    });
  }

  // === ЗАГРУЗКА ДАННЫХ ===

  // Загрузка дашборда
  async loadDashboard() {
    try {
      this.updateConnectionStatus('connected');
      
      // Загружаем статистику параллельно
      const [systemInfo, globalStats] = await Promise.all([
        this.makeRequest('GET', '/system'),
        fetch('/api/stats/global').then(r => r.json())
      ]);

      this.updateStatsCards(globalStats.stats);
      this.updateSystemInfo(systemInfo.system);
      
    } catch (error) {
      console.error('Dashboard loading error:', error);
      this.showAlert('danger', `Ошибка загрузки: ${error.message}`);
      this.updateConnectionStatus('disconnected');
    }
  }

  // Загрузка настроек
  async loadSettings() {
    try {
      const response = await this.makeRequest('GET', '/settings');
      
      if (response.success && response.current) {
        const settings = response.current;
        
        document.getElementById('required_participants').value = settings.required_participants;
        document.getElementById('bid_amount').value = settings.bid_amount;
        document.getElementById('winner_percentage').value = (settings.winner_percentage * 100).toFixed(0);
        document.getElementById('admin_percentage').value = (settings.admin_percentage * 100).toFixed(0);
      }
    } catch (error) {
      console.error('Settings loading error:', error);
      this.showAlert('danger', `Ошибка загрузки настроек: ${error.message}`);
    }
  }

  // Загрузка лотерей
  async loadRaffles(page = 1) {
    try {
      const status = document.getElementById('raffle-status-filter')?.value || '';
      const params = new URLSearchParams({ page, limit: 20 });
      
      if (status) params.append('status', status);
      
      const response = await this.makeRequest('GET', `/raffles?${params}`);
      
      if (response.success) {
        this.updateRafflesTable(response.raffles);
        this.updateRafflesPagination(response.pagination);
      }
    } catch (error) {
      console.error('Raffles loading error:', error);
      this.showAlert('danger', `Ошибка загрузки лотерей: ${error.message}`);
    }
  }

  // === ДЕЙСТВИЯ ===

  // Сохранение настроек
  async saveSettings() {
    try {
      const formData = {
        required_participants: parseInt(document.getElementById('required_participants').value),
        bid_amount: parseInt(document.getElementById('bid_amount').value),
        winner_percentage: parseFloat(document.getElementById('winner_percentage').value) / 100,
        admin_percentage: parseFloat(document.getElementById('admin_percentage').value) / 100
      };

      // Валидация
      if (formData.winner_percentage + formData.admin_percentage !== 1) {
        throw new Error('Сумма процентов должна равняться 100%');
      }

      const response = await this.makeRequest('PUT', '/settings', formData);
      
      if (response.success) {
        this.showAlert('success', 'Настройки сохранены успешно');
      }
    } catch (error) {
      console.error('Settings save error:', error);
      this.showAlert('danger', `Ошибка сохранения: ${error.message}`);
    }
  }

  // Создание лотереи
  async createRaffle() {
    if (!confirm('Создать новую лотерею?')) return;
    
    try {
      const response = await this.makeRequest('POST', '/raffles/create');
      
      if (response.success) {
        this.showAlert('success', 'Новая лотерея создана');
        this.loadRaffles();
      }
    } catch (error) {
      console.error('Raffle creation error:', error);
      this.showAlert('danger', `Ошибка создания лотереи: ${error.message}`);
    }
  }

  // Отмена лотереи
  async cancelRaffle(raffleId) {
    const reason = prompt('Причина отмены лотереи:');
    if (!reason) return;
    
    try {
      const response = await this.makeRequest('POST', `/raffles/${raffleId}/cancel`, { reason });
      
      if (response.success) {
        this.showAlert('success', 'Лотерея отменена');
        this.loadRaffles();
      }
    } catch (error) {
      console.error('Raffle cancellation error:', error);
      this.showAlert('danger', `Ошибка отмены лотереи: ${error.message}`);
    }
  }

  // === ОБНОВЛЕНИЕ UI ===

  // Обновление карточек статистики
  updateStatsCards(stats) {
    const container = document.getElementById('stats-cards');
    
    const cards = [
      {
        title: 'Всего пользователей',
        value: this.formatNumber(stats.total_users || 0),
        icon: 'fas fa-users',
        color: 'primary'
      },
      {
        title: 'Активных за 24ч',
        value: this.formatNumber(stats.active_users_24h || 0),
        icon: 'fas fa-user-clock',
        color: 'success'
      },
      {
        title: 'Завершено лотерей',
        value: this.formatNumber(stats.total_raffles_completed || 0),
        icon: 'fas fa-trophy',
        color: 'warning'
      },
      {
        title: 'Выдано призов',
        value: `${this.formatNumber(stats.total_prizes_distributed || 0)} ⭐`,
        icon: 'fas fa-star',
        color: 'info'
      }
    ];

    container.innerHTML = cards.map(card => `
      <div class="col-md-3">
        <div class="card stats-card text-bg-${card.color}">
          <div class="card-body">
            <div class="d-flex align-items-center">
              <div class="flex-shrink-0">
                <i class="${card.icon} fa-2x"></i>
              </div>
              <div class="flex-grow-1 ms-3">
                <div class="stats-number">${card.value}</div>
                <div class="stats-label">${card.title}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Обновление информации о системе
  updateSystemInfo(systemInfo) {
    const connectionsContainer = document.getElementById('active-connections');
    
    if (systemInfo.websockets) {
      connectionsContainer.innerHTML = `
        <div class="row">
          <div class="col-6">
            <div class="text-center">
              <div class="h3 text-primary">${systemInfo.websockets.total_connections}</div>
              <div class="text-muted">Всего подключений</div>
            </div>
          </div>
          <div class="col-6">
            <div class="text-center">
              <div class="h3 text-success">${systemInfo.websockets.authenticated_users}</div>
              <div class="text-muted">Авторизованных</div>
            </div>
          </div>
        </div>
        <hr>
        <small class="text-muted">
          Uptime: ${Math.floor(systemInfo.server.uptime / 60)} мин<br>
          Memory: ${Math.round(systemInfo.server.memory.heapUsed / 1024 / 1024)} MB
        </small>
      `;
    } else {
      connectionsContainer.innerHTML = '<p class="text-muted">Данные недоступны</p>';
    }
  }

  // Обновление таблицы лотерей
  updateRafflesTable(raffles) {
    const tbody = document.getElementById('raffles-table');
    
    if (!raffles || raffles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Нет данных</td></tr>';
      return;
    }

    tbody.innerHTML = raffles.map(raffle => {
      const statusClass = {
        active: 'success',
        completed: 'primary',
        cancelled: 'danger'
      }[raffle.status] || 'secondary';

      const winnerInfo = raffle.winner_info ? 
        `${raffle.winner_info.first_name || 'User'} (${raffle.winner_prize} ⭐)` : 
        '-';

      return `
        <tr>
          <td>${raffle.id}</td>
          <td><span class="badge bg-${statusClass}">${this.getStatusText(raffle.status)}</span></td>
          <td>${raffle.total_participants || 0}/${raffle.required_participants}</td>
          <td>${raffle.total_prize || 0} ⭐</td>
          <td>${winnerInfo}</td>
          <td>${this.formatDate(raffle.created_at)}</td>
          <td>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-info" onclick="adminPanel.viewRaffleDetails(${raffle.id})">
                <i class="fas fa-eye"></i>
              </button>
              ${raffle.status === 'active' ? `
                <button class="btn btn-outline-danger" onclick="adminPanel.cancelRaffle(${raffle.id})">
                  <i class="fas fa-ban"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Обновление пагинации лотерей
  updateRafflesPagination(pagination) {
    const container = document.getElementById('raffles-pagination');
    
    if (!pagination || pagination.totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let paginationHtml = '';
    
    // Предыдущая страница
    if (pagination.hasPrev) {
      paginationHtml += `
        <li class="page-item">
          <a class="page-link" href="#" onclick="adminPanel.loadRaffles(${pagination.page - 1})">Назад</a>
        </li>
      `;
    }

    // Номера страниц
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.totalPages, pagination.page + 2);

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `
        <li class="page-item ${i === pagination.page ? 'active' : ''}">
          <a class="page-link" href="#" onclick="adminPanel.loadRaffles(${i})">${i}</a>
        </li>
      `;
    }

    // Следующая страница
    if (pagination.hasNext) {
      paginationHtml += `
        <li class="page-item">
          <a class="page-link" href="#" onclick="adminPanel.loadRaffles(${pagination.page + 1})">Вперед</a>
        </li>
      `;
    }

    container.innerHTML = paginationHtml;
  }

  // === ОБРАБОТЧИКИ ВКЛАДОК ===

  handleTabChange(tabName) {
    switch (tabName) {
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'raffles':
        this.loadRaffles();
        break;
      case 'settings':
        this.loadSettings();
        break;
      // Добавить обработку других вкладок по мере необходимости
    }
  }

  // === УТИЛИТЫ ===

  // Обновление статуса подключения
  updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    const statusText = statusElement.querySelector('span');
    
    statusElement.className = `connection-status ${status}`;
    
    switch (status) {
      case 'connected':
        statusText.textContent = 'Подключено';
        break;
      case 'disconnected':
        statusText.textContent = 'Отключено';
        break;
      case 'connecting':
        statusText.textContent = 'Подключение...';
        break;
    }
  }

  // Показать уведомление
  showAlert(type, message, duration = 5000) {
    // Удаляем существующие уведомления
    document.querySelectorAll('.alert-notification').forEach(alert => alert.remove());
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show alert-notification`;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.left = '50%';
    alertDiv.style.transform = 'translateX(-50%)';
    alertDiv.style.zIndex = '1060';
    alertDiv.style.minWidth = '300px';
    
    alertDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    if (duration > 0) {
      setTimeout(() => alertDiv.remove(), duration);
    }
  }

  // Показать ошибку входа
  showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('d-none');
    
    setTimeout(() => {
      errorDiv.classList.add('d-none');
    }, 5000);
  }

  // Форматирование чисел
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  // Форматирование даты
  formatDate(dateString) {
    if (!dateString) return '-';
    
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Получение текста статуса
  getStatusText(status) {
    const statusMap = {
      active: 'Активна',
      completed: 'Завершена',
      cancelled: 'Отменена'
    };
    return statusMap[status] || status;
  }

  // Автообновление
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      if (this.isAuthenticated) {
        // Обновляем только активную вкладку
        const activeTab = document.querySelector('#admin-tabs .nav-link.active');
        if (activeTab) {
          const tabName = activeTab.getAttribute('href').substring(1);
          if (tabName === 'dashboard') {
            this.loadDashboard();
          } else if (tabName === 'raffles') {
            this.loadRaffles();
          }
        }
      }
    }, 30000); // Обновление каждые 30 секунд
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Просмотр деталей лотереи
  async viewRaffleDetails(raffleId) {
    try {
      const response = await this.makeRequest('GET', `/raffles/${raffleId}`);
      
      if (response.success) {
        // Показать модальное окно с деталями лотереи
        this.showRaffleDetailsModal(response.raffle, response.participants);
      }
    } catch (error) {
      this.showAlert('danger', `Ошибка загрузки деталей: ${error.message}`);
    }
  }

  // Показать модальное окно с деталями лотереи
  showRaffleDetailsModal(raffle, participants) {
    // Создание и показ модального окна с подробной информацией
    // Реализация зависит от требований UI
    alert(`Лотерея #${raffle.id}\nУчастников: ${participants.length}\nСтатус: ${raffle.status}`);
  }
}

// Инициализация панели при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  window.adminPanel = new AdminPanel();
});

// Обработка ошибок JavaScript
window.addEventListener('error', (e) => {
  console.error('JavaScript error:', e.error);
});

// Предотвращение случайного закрытия вкладки
window.addEventListener('beforeunload', (e) => {
  if (window.adminPanel && window.adminPanel.isAuthenticated) {
    e.preventDefault();
    e.returnValue = '';
  }
});