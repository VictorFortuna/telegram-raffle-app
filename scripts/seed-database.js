require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function seedDatabase() {
  let client;
  
  try {
    client = await pool.connect();
    
    console.log('🌱 Seeding database with test data...');
    
    // Очищаем существующие данные (осторожно!)
    if (process.env.NODE_ENV !== 'production') {
      console.log('🗑️ Clearing existing data...');
      await client.query('TRUNCATE TABLE audit_logs CASCADE');
      await client.query('TRUNCATE TABLE star_transactions CASCADE');
      await client.query('TRUNCATE TABLE bids CASCADE');
      await client.query('TRUNCATE TABLE raffles CASCADE');
      await client.query('TRUNCATE TABLE users CASCADE');
      await client.query('TRUNCATE TABLE raffle_settings CASCADE');
    }
    
    // 1. Создаем тестовых пользователей
    console.log('👥 Creating test users...');
    const testUsers = [
      {
        telegram_id: 123456789,
        username: 'testuser1',
        first_name: 'Алексей',
        last_name: 'Тестов',
        stars_balance: 50,
        total_bids: 5,
        total_winnings: 25
      },
      {
        telegram_id: 987654321,
        username: 'testuser2',
        first_name: 'Мария',
        last_name: 'Иванова',
        stars_balance: 30,
        total_bids: 3,
        total_winnings: 0
      },
      {
        telegram_id: 555666777,
        username: 'winner_user',
        first_name: 'Победитель',
        last_name: 'Удачливый',
        stars_balance: 100,
        total_bids: 10,
        total_winnings: 150
      },
      {
        telegram_id: 111222333,
        username: 'newbie',
        first_name: 'Новичок',
        last_name: 'Начинающий',
        stars_balance: 10,
        total_bids: 1,
        total_winnings: 0
      },
      {
        telegram_id: 444555666,
        username: 'regular_player',
        first_name: 'Игрок',
        last_name: 'Постоянный',
        stars_balance: 75,
        total_bids: 8,
        total_winnings: 40
      }
    ];

    for (const user of testUsers) {
      await client.query(`
        INSERT INTO users (
          telegram_id, username, first_name, last_name, 
          stars_balance, total_bids, total_winnings, 
          created_at, last_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '${Math.floor(Math.random() * 30)} days', NOW() - INTERVAL '${Math.floor(Math.random() * 24)} hours')
      `, [
        user.telegram_id, user.username, user.first_name, user.last_name,
        user.stars_balance, user.total_bids, user.total_winnings
      ]);
    }

    // 2. Создаем настройки лотереи
    console.log('⚙️ Creating raffle settings...');
    await client.query(`
      INSERT INTO raffle_settings (
        required_participants, bid_amount, winner_percentage, admin_percentage, is_active
      ) VALUES ($1, $2, $3, $4, $5)
    `, [10, 1, 0.70, 0.30, true]);

    // 3. Создаем завершенные лотереи
    console.log('🎲 Creating completed raffles...');
    const completedRaffles = [
      {
        required_participants: 10,
        current_participants: 10,
        total_prize: 10,
        winner_id: 555666777,
        winner_prize: 7,
        admin_fee: 3,
        completed_days_ago: 5
      },
      {
        required_participants: 8,
        current_participants: 8,
        total_prize: 8,
        winner_id: 123456789,
        winner_prize: 6,
        admin_fee: 2,
        completed_days_ago: 3
      },
      {
        required_participants: 12,
        current_participants: 12,
        total_prize: 12,
        winner_id: 444555666,
        winner_prize: 8,
        admin_fee: 4,
        completed_days_ago: 1
      }
    ];

    for (let i = 0; i < completedRaffles.length; i++) {
      const raffle = completedRaffles[i];
      
      // Создаем лотерею
      const raffleResult = await client.query(`
        INSERT INTO raffles (
          required_participants, bid_amount, current_participants, total_prize,
          status, winner_telegram_id, winner_prize, admin_fee, winner_selection_seed,
          created_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        raffle.required_participants, 1, raffle.current_participants, raffle.total_prize,
        'completed', raffle.winner_id, raffle.winner_prize, raffle.admin_fee,
        `seed_${Date.now()}_${i}`,
        `NOW() - INTERVAL '${raffle.completed_days_ago + 1} days'`,
        `NOW() - INTERVAL '${raffle.completed_days_ago} days'`
      ]);

      const raffleId = raffleResult.rows[0].id;

      // Создаем ставки для этой лотереи
      const participants = testUsers.slice(0, raffle.current_participants);
      for (let j = 0; j < participants.length; j++) {
        await client.query(`
          INSERT INTO bids (
            raffle_id, user_telegram_id, amount, bid_position, 
            transaction_id, status, placed_at, confirmed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          raffleId, participants[j].telegram_id, 1, j + 1,
          `tx_${raffleId}_${j}`, 'confirmed',
          `NOW() - INTERVAL '${raffle.completed_days_ago + 1} days' + INTERVAL '${j * 10} minutes'`,
          `NOW() - INTERVAL '${raffle.completed_days_ago + 1} days' + INTERVAL '${j * 10 + 1} minutes'`
        ]);

        // Создаем транзакцию ставки
        await client.query(`
          INSERT INTO star_transactions (
            telegram_id, transaction_type, amount, telegram_transaction_id,
            raffle_id, status, created_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          participants[j].telegram_id, 'bid', 1, `tx_${raffleId}_${j}`,
          raffleId, 'completed',
          `NOW() - INTERVAL '${raffle.completed_days_ago + 1} days' + INTERVAL '${j * 10} minutes'`,
          `NOW() - INTERVAL '${raffle.completed_days_ago + 1} days' + INTERVAL '${j * 10 + 1} minutes'`
        ]);
      }

      // Создаем транзакцию выигрыша
      await client.query(`
        INSERT INTO star_transactions (
          telegram_id, transaction_type, amount, telegram_transaction_id,
          raffle_id, status, created_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        raffle.winner_id, 'prize', raffle.winner_prize, `prize_${raffleId}`,
        raffleId, 'completed',
        `NOW() - INTERVAL '${raffle.completed_days_ago} days'`,
        `NOW() - INTERVAL '${raffle.completed_days_ago} days'`
      ]);
    }

    // 4. Создаем текущую активную лотерею
    console.log('🎯 Creating active raffle...');
    const activeRaffleResult = await client.query(`
      INSERT INTO raffles (
        required_participants, bid_amount, current_participants, total_prize, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [10, 1, 3, 3, 'active']);

    const activeRaffleId = activeRaffleResult.rows[0].id;

    // Добавляем несколько участников в активную лотерею
    const activeParticipants = testUsers.slice(0, 3);
    for (let i = 0; i < activeParticipants.length; i++) {
      await client.query(`
        INSERT INTO bids (
          raffle_id, user_telegram_id, amount, bid_position,
          transaction_id, status, placed_at, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        activeRaffleId, activeParticipants[i].telegram_id, 1, i + 1,
        `active_tx_${i}`, 'confirmed',
        `NOW() - INTERVAL '${30 - i * 10} minutes'`,
        `NOW() - INTERVAL '${29 - i * 10} minutes'`
      ]);

      await client.query(`
        INSERT INTO star_transactions (
          telegram_id, transaction_type, amount, telegram_transaction_id,
          raffle_id, status, created_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        activeParticipants[i].telegram_id, 'bid', 1, `active_tx_${i}`,
        activeRaffleId, 'completed',
        `NOW() - INTERVAL '${30 - i * 10} minutes'`,
        `NOW() - INTERVAL '${29 - i * 10} minutes'`
      ]);
    }

    // 5. Создаем записи аудита
    console.log('📋 Creating audit logs...');
    const auditActions = [
      { action: 'RAFFLE_COMPLETED', entity_type: 'raffle', details: { admin: 'system' } },
      { action: 'SETTINGS_UPDATED', entity_type: 'raffle_settings', details: { admin: 'admin' } },
      { action: 'USER_REGISTERED', entity_type: 'user', details: { source: 'telegram' } },
      { action: 'RAFFLE_CREATED', entity_type: 'raffle', details: { admin: 'system' } }
    ];

    for (let i = 0; i < auditActions.length; i++) {
      await client.query(`
        INSERT INTO audit_logs (action, entity_type, entity_id, details, created_at)
        VALUES ($1, $2, $3, $4, NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days')
      `, [
        auditActions[i].action,
        auditActions[i].entity_type,
        Math.floor(Math.random() * 10) + 1,
        JSON.stringify(auditActions[i].details)
      ]);
    }

    // 6. Создаем хэш пароля администратора для демонстрации
    if (!process.env.ADMIN_PASSWORD_HASH) {
      console.log('🔐 Creating demo admin password hash...');
      const demoPassword = 'admin123';
      const hash = await bcrypt.hash(demoPassword, 10);
      console.log(`Demo admin credentials:`);
      console.log(`Username: admin`);
      console.log(`Password: ${demoPassword}`);
      console.log(`Add to .env: ADMIN_PASSWORD_HASH=${hash}`);
    }

    console.log('✅ Database seeding completed successfully!');
    console.log('\n📊 Test Data Summary:');
    console.log(`- 👥 Users: ${testUsers.length}`);
    console.log(`- 🎲 Completed raffles: ${completedRaffles.length}`);
    console.log(`- ⚡ Active raffles: 1 (${activeParticipants.length}/10 participants)`);
    console.log(`- 📋 Audit logs: ${auditActions.length}`);
    
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = seedDatabase;