const db = require('../services/databaseService');

class RaffleSettings {
  constructor(data) {
    this.id = data.id;
    this.required_participants = data.required_participants;
    this.bid_amount = data.bid_amount;
    this.winner_percentage = parseFloat(data.winner_percentage);
    this.admin_percentage = parseFloat(data.admin_percentage);
    this.is_active = data.is_active;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async getCurrent() {
    try {
      const result = await db.query(
        'SELECT * FROM raffle_settings WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
      );
      
      return result.rows.length > 0 ? new RaffleSettings(result.rows[0]) : null;
    } catch (error) {
      console.error('Error getting current raffle settings:', error);
      throw error;
    }
  }

  static async create(settingsData) {
    try {
      // Валидация данных
      RaffleSettings.validateSettings(settingsData);

      // Деактивируем старые настройки
      await db.query('UPDATE raffle_settings SET is_active = false');

      // Создаем новые настройки
      const result = await db.query(`
        INSERT INTO raffle_settings (
          required_participants, bid_amount, winner_percentage, 
          admin_percentage, is_active
        ) VALUES ($1, $2, $3, $4, true)
        RETURNING *
      `, [
        settingsData.required_participants,
        settingsData.bid_amount,
        settingsData.winner_percentage,
        settingsData.admin_percentage
      ]);

      return new RaffleSettings(result.rows[0]);
    } catch (error) {
      console.error('Error creating raffle settings:', error);
      throw error;
    }
  }

  static async update(id, settingsData) {
    try {
      // Валидация данных
      RaffleSettings.validateSettings(settingsData);

      const result = await db.query(`
        UPDATE raffle_settings 
        SET required_participants = $1, bid_amount = $2, 
            winner_percentage = $3, admin_percentage = $4,
            updated_at = NOW()
        WHERE id = $5 AND is_active = true
        RETURNING *
      `, [
        settingsData.required_participants,
        settingsData.bid_amount,
        settingsData.winner_percentage,
        settingsData.admin_percentage,
        id
      ]);

      if (result.rows.length === 0) {
        throw new Error('SETTINGS_NOT_FOUND');
      }

      return new RaffleSettings(result.rows[0]);
    } catch (error) {
      console.error('Error updating raffle settings:', error);
      throw error;
    }
  }

  static validateSettings(data) {
    const errors = [];

    // Проверяем обязательные поля
    if (!data.required_participants || data.required_participants < 2) {
      errors.push('required_participants должно быть минимум 2');
    }

    if (!data.bid_amount || data.bid_amount < 1) {
      errors.push('bid_amount должно быть минимум 1 звезда');
    }

    if (data.winner_percentage === undefined || data.winner_percentage < 0.1 || data.winner_percentage > 0.9) {
      errors.push('winner_percentage должно быть от 0.1 до 0.9 (10% - 90%)');
    }

    if (data.admin_percentage === undefined || data.admin_percentage < 0.1 || data.admin_percentage > 0.9) {
      errors.push('admin_percentage должно быть от 0.1 до 0.9 (10% - 90%)');
    }

    // Проверяем, что сумма процентов равна 100%
    const totalPercentage = (data.winner_percentage || 0) + (data.admin_percentage || 0);
    if (Math.abs(totalPercentage - 1.0) > 0.001) {
      errors.push('Сумма winner_percentage и admin_percentage должна быть равна 1.0 (100%)');
    }

    // Проверяем разумные лимиты
    if (data.required_participants > 1000) {
      errors.push('required_participants не может быть больше 1000');
    }

    if (data.bid_amount > 1000) {
      errors.push('bid_amount не может быть больше 1000 звезд');
    }

    if (errors.length > 0) {
      const error = new Error(`Validation failed: ${errors.join(', ')}`);
      error.code = 'VALIDATION_ERROR';
      error.errors = errors;
      throw error;
    }
  }

  static async getHistory(limit = 50) {
    try {
      const result = await db.query(
        'SELECT * FROM raffle_settings ORDER BY created_at DESC LIMIT $1',
        [limit]
      );

      return result.rows.map(row => new RaffleSettings(row));
    } catch (error) {
      console.error('Error getting raffle settings history:', error);
      throw error;
    }
  }

  async deactivate() {
    try {
      const result = await db.query(
        'UPDATE raffle_settings SET is_active = false WHERE id = $1 RETURNING *',
        [this.id]
      );

      if (result.rows.length > 0) {
        this.is_active = false;
      }

      return this;
    } catch (error) {
      console.error('Error deactivating raffle settings:', error);
      throw error;
    }
  }

  // Проверяет, можно ли создать новую лотерею с этими настройками
  async canCreateNewRaffle() {
    try {
      // Проверяем, есть ли активная лотерея
      const activeRaffleResult = await db.query(
        'SELECT id FROM raffles WHERE status = $1',
        ['active']
      );

      return activeRaffleResult.rows.length === 0;
    } catch (error) {
      console.error('Error checking if can create new raffle:', error);
      throw error;
    }
  }

  // Получаем статистику использования настроек
  async getUsageStats() {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_raffles,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_raffles,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_raffles,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_raffles,
          SUM(CASE WHEN status = 'completed' THEN total_prize ELSE 0 END) as total_prizes_distributed
        FROM raffles 
        WHERE required_participants = $1 AND bid_amount = $2
      `, [this.required_participants, this.bid_amount]);

      return result.rows[0];
    } catch (error) {
      console.error('Error getting settings usage stats:', error);
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      required_participants: this.required_participants,
      bid_amount: this.bid_amount,
      winner_percentage: this.winner_percentage,
      admin_percentage: this.admin_percentage,
      is_active: this.is_active,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  // Получаем публичную информацию для фронтенда
  getPublicInfo() {
    return {
      required_participants: this.required_participants,
      bid_amount: this.bid_amount,
      winner_percentage: this.winner_percentage,
      admin_percentage: this.admin_percentage
    };
  }
}

module.exports = RaffleSettings;