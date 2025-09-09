const db = require('../services/databaseService');

class User {
  constructor(data) {
    this.telegram_id = data.telegram_id;
    this.username = data.username;
    this.first_name = data.first_name;
    this.last_name = data.last_name;
    this.language_code = data.language_code || 'ru';
    this.stars_balance = data.stars_balance || 0;
    this.total_bids = data.total_bids || 0;
    this.total_winnings = data.total_winnings || 0;
    this.created_at = data.created_at;
    this.last_active = data.last_active;
    this.last_balance_check = data.last_balance_check;
  }

  static async findByTelegramId(telegramId) {
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      
      return result.rows.length > 0 ? new User(result.rows[0]) : null;
    } catch (error) {
      console.error('Error finding user by telegram ID:', error);
      throw error;
    }
  }

  static async create(userData) {
    try {
      const result = await db.query(`
        INSERT INTO users (
          telegram_id, username, first_name, last_name, 
          language_code, last_active
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (telegram_id) 
        DO UPDATE SET 
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          last_active = NOW()
        RETURNING *
      `, [
        userData.telegram_id,
        userData.username,
        userData.first_name,
        userData.last_name,
        userData.language_code || 'ru'
      ]);

      return new User(result.rows[0]);
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw error;
    }
  }

  async updateStarsBalance(newBalance) {
    try {
      const result = await db.query(`
        UPDATE users 
        SET stars_balance = $1, last_balance_check = NOW(), last_active = NOW()
        WHERE telegram_id = $2
        RETURNING *
      `, [newBalance, this.telegram_id]);

      if (result.rows.length > 0) {
        Object.assign(this, result.rows[0]);
      }
      return this;
    } catch (error) {
      console.error('Error updating user stars balance:', error);
      throw error;
    }
  }

  async updateActivity() {
    try {
      await db.query(
        'UPDATE users SET last_active = NOW() WHERE telegram_id = $1',
        [this.telegram_id]
      );
      this.last_active = new Date();
      return this;
    } catch (error) {
      console.error('Error updating user activity:', error);
      throw error;
    }
  }

  async incrementBidsCount() {
    try {
      const result = await db.query(`
        UPDATE users 
        SET total_bids = total_bids + 1, last_active = NOW()
        WHERE telegram_id = $1
        RETURNING total_bids
      `, [this.telegram_id]);

      this.total_bids = result.rows[0].total_bids;
      return this;
    } catch (error) {
      console.error('Error incrementing user bids count:', error);
      throw error;
    }
  }

  async addWinnings(amount) {
    try {
      const result = await db.query(`
        UPDATE users 
        SET total_winnings = total_winnings + $1, last_active = NOW()
        WHERE telegram_id = $2
        RETURNING total_winnings
      `, [amount, this.telegram_id]);

      this.total_winnings = result.rows[0].total_winnings;
      return this;
    } catch (error) {
      console.error('Error adding user winnings:', error);
      throw error;
    }
  }

  static async getTotalUsers() {
    try {
      const result = await db.query('SELECT COUNT(*) as count FROM users');
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting total users count:', error);
      throw error;
    }
  }

  static async getActiveUsers(hours = 24) {
    try {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE last_active > NOW() - INTERVAL \'$1 hours\'',
        [hours]
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting active users count:', error);
      throw error;
    }
  }

  static async getTopWinners(limit = 10) {
    try {
      const result = await db.query(`
        SELECT telegram_id, username, first_name, total_winnings
        FROM users 
        WHERE total_winnings > 0
        ORDER BY total_winnings DESC 
        LIMIT $1
      `, [limit]);

      return result.rows.map(row => new User(row));
    } catch (error) {
      console.error('Error getting top winners:', error);
      throw error;
    }
  }

  // Получить статистику пользователя
  getPublicStats() {
    return {
      username: this.username,
      first_name: this.first_name,
      stars_balance: this.stars_balance,
      total_bids: this.total_bids,
      total_winnings: this.total_winnings,
      member_since: this.created_at
    };
  }

  // Получить полную информацию (для самого пользователя)
  getFullProfile() {
    return {
      telegram_id: this.telegram_id,
      username: this.username,
      first_name: this.first_name,
      last_name: this.last_name,
      language_code: this.language_code,
      stars_balance: this.stars_balance,
      total_bids: this.total_bids,
      total_winnings: this.total_winnings,
      created_at: this.created_at,
      last_active: this.last_active,
      last_balance_check: this.last_balance_check
    };
  }
}

module.exports = User;