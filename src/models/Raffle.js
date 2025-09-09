const db = require('../services/databaseService');
const crypto = require('crypto');

class Raffle {
  constructor(data) {
    this.id = data.id;
    this.required_participants = data.required_participants;
    this.bid_amount = data.bid_amount;
    this.current_participants = data.current_participants || 0;
    this.total_prize = data.total_prize || 0;
    this.status = data.status || 'active';
    this.winner_telegram_id = data.winner_telegram_id;
    this.winner_prize = data.winner_prize;
    this.admin_fee = data.admin_fee;
    this.winner_selection_seed = data.winner_selection_seed;
    this.created_at = data.created_at;
    this.completed_at = data.completed_at;
  }

  static async getCurrentActive() {
    try {
      const result = await db.query(
        'SELECT * FROM raffles WHERE status = $1 ORDER BY created_at DESC LIMIT 1',
        ['active']
      );
      
      return result.rows.length > 0 ? new Raffle(result.rows[0]) : null;
    } catch (error) {
      console.error('Error getting current active raffle:', error);
      throw error;
    }
  }

  static async create(settings) {
    try {
      const result = await db.query(`
        INSERT INTO raffles (required_participants, bid_amount, total_prize)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [settings.required_participants, settings.bid_amount, 0]);

      return new Raffle(result.rows[0]);
    } catch (error) {
      console.error('Error creating raffle:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const result = await db.query('SELECT * FROM raffles WHERE id = $1', [id]);
      return result.rows.length > 0 ? new Raffle(result.rows[0]) : null;
    } catch (error) {
      console.error('Error finding raffle by ID:', error);
      throw error;
    }
  }

  async addParticipant(telegramId, amount, transactionId) {
    return await db.transaction(async (client) => {
      try {
        // Проверяем, что лотерея активна
        const raffleCheck = await client.query(
          'SELECT * FROM raffles WHERE id = $1 AND status = $2 FOR UPDATE',
          [this.id, 'active']
        );

        if (raffleCheck.rows.length === 0) {
          throw new Error('RAFFLE_NOT_ACTIVE');
        }

        const currentRaffle = raffleCheck.rows[0];

        // Проверяем, что пользователь еще не участвует
        const existingBid = await client.query(
          'SELECT id FROM bids WHERE raffle_id = $1 AND user_telegram_id = $2',
          [this.id, telegramId]
        );

        if (existingBid.rows.length > 0) {
          throw new Error('ALREADY_PARTICIPATED');
        }

        // Проверяем, что лотерея не переполнена
        if (currentRaffle.current_participants >= currentRaffle.required_participants) {
          throw new Error('RAFFLE_FULL');
        }

        // Обновляем лотерею
        const updatedRaffle = await client.query(`
          UPDATE raffles 
          SET current_participants = current_participants + 1, 
              total_prize = total_prize + $1
          WHERE id = $2 
          RETURNING *
        `, [amount, this.id]);

        // Добавляем ставку
        const bidResult = await client.query(`
          INSERT INTO bids (
            raffle_id, user_telegram_id, amount, 
            bid_position, transaction_id, status
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [
          this.id,
          telegramId,
          amount,
          updatedRaffle.rows[0].current_participants,
          transactionId,
          'confirmed'
        ]);

        // Обновляем объект
        Object.assign(this, updatedRaffle.rows[0]);

        return {
          raffle: this,
          bid: bidResult.rows[0],
          shouldComplete: this.current_participants >= this.required_participants
        };
      } catch (error) {
        throw error;
      }
    });
  }

  async getParticipants() {
    try {
      const result = await db.query(`
        SELECT b.*, u.username, u.first_name, u.last_name
        FROM bids b
        JOIN users u ON b.user_telegram_id = u.telegram_id
        WHERE b.raffle_id = $1 AND b.status = 'confirmed'
        ORDER BY b.bid_position ASC
      `, [this.id]);

      return result.rows;
    } catch (error) {
      console.error('Error getting raffle participants:', error);
      throw error;
    }
  }

  async selectWinner(winnerPercentage = 0.70, adminPercentage = 0.30) {
    return await db.transaction(async (client) => {
      try {
        // Получаем всех участников
        const participantsResult = await client.query(
          'SELECT user_telegram_id FROM bids WHERE raffle_id = $1 AND status = $2 ORDER BY bid_position',
          [this.id, 'confirmed']
        );

        if (participantsResult.rows.length === 0) {
          throw new Error('NO_PARTICIPANTS');
        }

        const participants = participantsResult.rows.map(row => row.user_telegram_id);

        // Генерируем криптографически стойкий seed
        const seed = this.generateWinnerSeed(participants);
        
        // Выбираем победителя
        const winnerResult = this.selectWinnerFromSeed(seed, participants);
        
        // Рассчитываем призы
        const winnerPrize = Math.floor(this.total_prize * winnerPercentage);
        const adminFee = this.total_prize - winnerPrize;

        // Обновляем лотерею
        await client.query(`
          UPDATE raffles 
          SET status = $1, winner_telegram_id = $2, winner_prize = $3, 
              admin_fee = $4, winner_selection_seed = $5, completed_at = NOW()
          WHERE id = $6
        `, [
          'completed',
          winnerResult.winnerId,
          winnerPrize,
          adminFee,
          seed,
          this.id
        ]);

        // Обновляем статистику победителя
        await client.query(
          'UPDATE users SET total_winnings = total_winnings + $1 WHERE telegram_id = $2',
          [winnerPrize, winnerResult.winnerId]
        );

        // Логируем завершение лотереи
        await client.query(`
          INSERT INTO audit_logs (action, entity_type, entity_id, details)
          VALUES ($1, $2, $3, $4)
        `, [
          'RAFFLE_COMPLETED',
          'raffle',
          this.id,
          JSON.stringify({
            winner_id: winnerResult.winnerId,
            winner_prize: winnerPrize,
            admin_fee: adminFee,
            total_participants: participants.length,
            seed: seed
          })
        ]);

        // Обновляем объект
        this.status = 'completed';
        this.winner_telegram_id = winnerResult.winnerId;
        this.winner_prize = winnerPrize;
        this.admin_fee = adminFee;
        this.winner_selection_seed = seed;
        this.completed_at = new Date();

        return {
          winner_id: winnerResult.winnerId,
          winner_prize: winnerPrize,
          admin_fee: adminFee,
          seed: seed,
          verification_hash: winnerResult.verificationHash
        };
      } catch (error) {
        throw error;
      }
    });
  }

  generateWinnerSeed(participantIds) {
    const data = [
      this.id.toString(),
      participantIds.sort().join(','),
      Date.now().toString(),
      crypto.randomBytes(32).toString('hex')
    ].join('|');
    
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  selectWinnerFromSeed(seed, participantIds) {
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    const randomValue = parseInt(hash.substring(0, 8), 16);
    const winnerIndex = randomValue % participantIds.length;
    
    return {
      winnerId: participantIds[winnerIndex],
      winnerIndex: winnerIndex,
      seed: seed,
      verificationHash: hash
    };
  }

  static async verifyWinnerSelection(raffleId) {
    try {
      const raffleResult = await db.query(
        'SELECT * FROM raffles WHERE id = $1',
        [raffleId]
      );

      if (raffleResult.rows.length === 0) {
        throw new Error('RAFFLE_NOT_FOUND');
      }

      const raffle = new Raffle(raffleResult.rows[0]);

      if (raffle.status !== 'completed' || !raffle.winner_selection_seed) {
        throw new Error('RAFFLE_NOT_COMPLETED');
      }

      // Получаем участников в том же порядке
      const participantsResult = await db.query(
        'SELECT user_telegram_id FROM bids WHERE raffle_id = $1 AND status = $2 ORDER BY bid_position',
        [raffleId, 'confirmed']
      );

      const participants = participantsResult.rows.map(row => row.user_telegram_id);

      // Пересчитываем победителя
      const verificationResult = raffle.selectWinnerFromSeed(raffle.winner_selection_seed, participants);

      return {
        is_valid: verificationResult.winnerId === raffle.winner_telegram_id,
        stored_winner: raffle.winner_telegram_id,
        calculated_winner: verificationResult.winnerId,
        seed: raffle.winner_selection_seed,
        verification_hash: verificationResult.verificationHash
      };
    } catch (error) {
      console.error('Error verifying winner selection:', error);
      throw error;
    }
  }

  static async getRecentCompleted(limit = 10) {
    try {
      const result = await db.query(`
        SELECT r.*, u.username, u.first_name
        FROM raffles r
        LEFT JOIN users u ON r.winner_telegram_id = u.telegram_id
        WHERE r.status = 'completed'
        ORDER BY r.completed_at DESC
        LIMIT $1
      `, [limit]);

      return result.rows.map(row => ({
        ...new Raffle(row),
        winner_info: {
          username: row.username,
          first_name: row.first_name
        }
      }));
    } catch (error) {
      console.error('Error getting recent completed raffles:', error);
      throw error;
    }
  }

  static async getTotalCompleted() {
    try {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM raffles WHERE status = $1',
        ['completed']
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting total completed raffles:', error);
      throw error;
    }
  }

  getPublicInfo() {
    return {
      id: this.id,
      required_participants: this.required_participants,
      bid_amount: this.bid_amount,
      current_participants: this.current_participants,
      total_prize: this.total_prize,
      status: this.status,
      created_at: this.created_at,
      completed_at: this.completed_at
    };
  }

  getCompletedInfo() {
    if (this.status !== 'completed') {
      return this.getPublicInfo();
    }

    return {
      ...this.getPublicInfo(),
      winner_telegram_id: this.winner_telegram_id,
      winner_prize: this.winner_prize,
      admin_fee: this.admin_fee
    };
  }
}

module.exports = Raffle;