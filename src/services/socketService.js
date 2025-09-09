class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // telegram_id -> socket.id
    this.activeConnections = new Set(); // активные socket.id
  }

  initialize(io) {
    this.io = io;
    this.setupEventHandlers();
    console.log('✅ Socket.IO service initialized');
  }

  setupEventHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      console.log(`🔌 User connected: ${socket.id}`);
      this.activeConnections.add(socket.id);

      // Аутентификация пользователя
      socket.on('authenticate', (data) => {
        try {
          const { telegram_id, username } = data;
          
          if (!telegram_id) {
            socket.emit('auth_error', { message: 'Telegram ID required' });
            return;
          }

          // Сохраняем связь пользователя с сокетом
          this.connectedUsers.set(telegram_id, socket.id);
          socket.telegram_id = telegram_id;
          socket.username = username;

          // Присоединяем к общей комнате
          socket.join('global_room');
          
          // Персональная комната пользователя
          socket.join(`user_${telegram_id}`);

          console.log(`✅ User authenticated: ${telegram_id} (${username}) -> ${socket.id}`);
          
          socket.emit('authenticated', { 
            success: true, 
            message: 'Successfully authenticated' 
          });

          // Отправляем текущее состояние лотереи
          this.sendCurrentRaffleState(socket);

        } catch (error) {
          console.error('Authentication error:', error);
          socket.emit('auth_error', { message: 'Authentication failed' });
        }
      });

      // Запрос текущего состояния лотереи
      socket.on('get_raffle_status', () => {
        this.sendCurrentRaffleState(socket);
      });

      // Запрос глобальной статистики
      socket.on('get_global_stats', () => {
        this.sendGlobalStats(socket);
      });

      // Запрос истории лотерей
      socket.on('get_recent_winners', () => {
        this.sendRecentWinners(socket);
      });

      // Обработка отключения
      socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);
        
        this.activeConnections.delete(socket.id);
        
        // Удаляем пользователя из карты подключений
        if (socket.telegram_id) {
          this.connectedUsers.delete(socket.telegram_id);
        }
      });

      // Обработка ошибок сокета
      socket.on('error', (error) => {
        console.error(`Socket error ${socket.id}:`, error);
      });
    });
  }

  // Отправка текущего состояния лотереи конкретному сокету
  async sendCurrentRaffleState(socket) {
    try {
      const Raffle = require('../models/Raffle');
      const RaffleSettings = require('../models/RaffleSettings');

      const currentRaffle = await Raffle.getCurrentActive();
      const settings = await RaffleSettings.getCurrent();

      if (currentRaffle && settings) {
        socket.emit('raffle_update', {
          raffle: currentRaffle.getPublicInfo(),
          settings: settings.getPublicInfo(),
          timestamp: new Date().toISOString()
        });
      } else {
        socket.emit('raffle_update', {
          raffle: null,
          settings: settings ? settings.getPublicInfo() : null,
          message: 'No active raffle',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error sending current raffle state:', error);
      socket.emit('error', { message: 'Failed to get raffle status' });
    }
  }

  // Отправка глобальной статистики
  async sendGlobalStats(socket) {
    try {
      const User = require('../models/User');
      const Raffle = require('../models/Raffle');

      const [totalUsers, totalRaffles] = await Promise.all([
        User.getTotalUsers(),
        Raffle.getTotalCompleted()
      ]);

      socket.emit('global_stats', {
        total_users: totalUsers,
        total_raffles: totalRaffles,
        active_connections: this.activeConnections.size,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error sending global stats:', error);
      socket.emit('error', { message: 'Failed to get global stats' });
    }
  }

  // Отправка недавних победителей
  async sendRecentWinners(socket) {
    try {
      const Raffle = require('../models/Raffle');
      const recentWinners = await Raffle.getRecentCompleted(5);

      socket.emit('recent_winners', {
        winners: recentWinners.map(raffle => ({
          raffle_id: raffle.id,
          winner_info: raffle.winner_info,
          prize: raffle.winner_prize,
          completed_at: raffle.completed_at
        })),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error sending recent winners:', error);
      socket.emit('error', { message: 'Failed to get recent winners' });
    }
  }

  // Уведомление о новой ставке
  notifyNewBid(raffleData, bidData) {
    if (!this.io) return;

    const notification = {
      type: 'NEW_BID',
      raffle: {
        id: raffleData.id,
        current_participants: raffleData.current_participants,
        required_participants: raffleData.required_participants,
        total_prize: raffleData.total_prize
      },
      bid: {
        position: bidData.bid_position,
        amount: bidData.amount
      },
      timestamp: new Date().toISOString()
    };

    this.io.to('global_room').emit('raffle_update', notification);
    console.log(`📢 Broadcasted new bid: ${raffleData.current_participants}/${raffleData.required_participants}`);
  }

  // Уведомление о завершении лотереи
  notifyRaffleCompleted(raffleData, winnerData) {
    if (!this.io) return;

    const notification = {
      type: 'RAFFLE_COMPLETED',
      raffle: {
        id: raffleData.id,
        status: 'completed',
        total_participants: raffleData.current_participants,
        total_prize: raffleData.total_prize,
        winner_prize: winnerData.winner_prize,
        completed_at: raffleData.completed_at
      },
      winner: {
        telegram_id: winnerData.winner_id,
        prize: winnerData.winner_prize
      },
      timestamp: new Date().toISOString()
    };

    // Уведомляем всех пользователей
    this.io.to('global_room').emit('raffle_completed', notification);
    
    // Отправляем персональное уведомление победителю
    if (this.connectedUsers.has(winnerData.winner_id)) {
      const winnerSocketId = this.connectedUsers.get(winnerData.winner_id);
      this.io.to(winnerSocketId).emit('you_won', {
        raffle_id: raffleData.id,
        prize: winnerData.winner_prize,
        message: 'Поздравляем! Вы выиграли!',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🎉 Broadcasted raffle completion: ${raffleData.id}, winner: ${winnerData.winner_id}`);
  }

  // Уведомление о создании новой лотереи
  notifyNewRaffleStarted(raffleData, settings) {
    if (!this.io) return;

    const notification = {
      type: 'NEW_RAFFLE_STARTED',
      raffle: raffleData.getPublicInfo(),
      settings: settings.getPublicInfo(),
      message: 'Новая лотерея началась!',
      timestamp: new Date().toISOString()
    };

    this.io.to('global_room').emit('new_raffle', notification);
    console.log(`🎲 Broadcasted new raffle started: ${raffleData.id}`);
  }

  // Персональное уведомление пользователю
  notifyUser(telegramId, event, data) {
    if (!this.io || !this.connectedUsers.has(telegramId)) {
      return false; // Пользователь не подключен
    }

    const socketId = this.connectedUsers.get(telegramId);
    this.io.to(socketId).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });

    console.log(`📬 Sent personal notification to ${telegramId}: ${event}`);
    return true;
  }

  // Обновление статистики пользователя
  notifyUserStatsUpdate(telegramId, stats) {
    return this.notifyUser(telegramId, 'user_stats_update', stats);
  }

  // Уведомление об ошибке транзакции
  notifyTransactionError(telegramId, error) {
    return this.notifyUser(telegramId, 'transaction_error', {
      message: error.message || 'Произошла ошибка транзакции',
      code: error.code || 'TRANSACTION_ERROR'
    });
  }

  // Уведомление о возврате средств
  notifyRefund(telegramId, amount, reason) {
    return this.notifyUser(telegramId, 'refund_notification', {
      amount: amount,
      reason: reason,
      message: `Возвращено ${amount} звезд. Причина: ${reason}`
    });
  }

  // Массовое уведомление всех подключенных пользователей
  broadcastToAll(event, data) {
    if (!this.io) return;

    this.io.to('global_room').emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });

    console.log(`📢 Broadcasted to all users: ${event}`);
  }

  // Уведомление о технических работах
  notifyMaintenance(message, duration) {
    this.broadcastToAll('maintenance_notification', {
      message: message,
      duration: duration,
      type: 'maintenance'
    });
  }

  // Системное уведомление
  notifySystemMessage(message, type = 'info') {
    this.broadcastToAll('system_message', {
      message: message,
      type: type // info, warning, error, success
    });
  }

  // Получение статистики подключений
  getConnectionStats() {
    return {
      total_connections: this.activeConnections.size,
      authenticated_users: this.connectedUsers.size,
      rooms: this.io ? Array.from(this.io.sockets.adapter.rooms.keys()) : [],
      timestamp: new Date().toISOString()
    };
  }

  // Отключение конкретного пользователя (админ функция)
  disconnectUser(telegramId, reason = 'Administrative action') {
    if (!this.connectedUsers.has(telegramId)) {
      return false;
    }

    const socketId = this.connectedUsers.get(telegramId);
    const socket = this.io.sockets.sockets.get(socketId);
    
    if (socket) {
      socket.emit('force_disconnect', { reason });
      socket.disconnect(true);
      console.log(`🔌 Force disconnected user ${telegramId}: ${reason}`);
      return true;
    }

    return false;
  }

  // Очистка неактивных соединений
  cleanup() {
    console.log('🧹 Cleaning up socket connections...');
    
    // Удаляем неактивные соединения из карты
    for (const [telegramId, socketId] of this.connectedUsers.entries()) {
      if (!this.activeConnections.has(socketId)) {
        this.connectedUsers.delete(telegramId);
      }
    }

    console.log(`✅ Cleanup complete. Active: ${this.activeConnections.size}, Authenticated: ${this.connectedUsers.size}`);
  }
}

module.exports = new SocketService();