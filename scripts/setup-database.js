require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const createTablesSQL = `
-- Пользователи системы
CREATE TABLE IF NOT EXISTS users (
    telegram_id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    language_code VARCHAR(10) DEFAULT 'ru',
    stars_balance INTEGER DEFAULT 0,
    total_bids INTEGER DEFAULT 0,
    total_winnings INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    last_active TIMESTAMP DEFAULT NOW(),
    last_balance_check TIMESTAMP
);

-- Настройки лотереи (администрируемые)
CREATE TABLE IF NOT EXISTS raffle_settings (
    id SERIAL PRIMARY KEY,
    required_participants INTEGER DEFAULT 10,
    bid_amount INTEGER DEFAULT 1,
    winner_percentage DECIMAL(3,2) DEFAULT 0.70,
    admin_percentage DECIMAL(3,2) DEFAULT 0.30,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Активные лотереи
CREATE TABLE IF NOT EXISTS raffles (
    id SERIAL PRIMARY KEY,
    required_participants INTEGER NOT NULL,
    bid_amount INTEGER NOT NULL,
    current_participants INTEGER DEFAULT 0,
    total_prize INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- active, completed, cancelled
    winner_telegram_id BIGINT REFERENCES users(telegram_id),
    winner_prize INTEGER,
    admin_fee INTEGER,
    winner_selection_seed VARCHAR(255), -- для воспроизводимости результата
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Ставки участников
CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    raffle_id INTEGER REFERENCES raffles(id) ON DELETE CASCADE,
    user_telegram_id BIGINT REFERENCES users(telegram_id),
    amount INTEGER NOT NULL,
    bid_position INTEGER, -- порядковый номер ставки в лотерее
    transaction_id VARCHAR(255), -- ID транзакции Telegram Stars
    status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, failed, refunded
    placed_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    
    UNIQUE(raffle_id, user_telegram_id) -- один пользователь - одна ставка
);

-- Транзакции Telegram Stars
CREATE TABLE IF NOT EXISTS star_transactions (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT REFERENCES users(telegram_id),
    transaction_type VARCHAR(20), -- bid, prize, refund
    amount INTEGER NOT NULL,
    telegram_transaction_id VARCHAR(255) UNIQUE,
    raffle_id INTEGER REFERENCES raffles(id),
    bid_id INTEGER REFERENCES bids(id),
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Логи действий для аудита
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    user_telegram_id BIGINT,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Создание индексов для оптимизации
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status);
CREATE INDEX IF NOT EXISTS idx_raffles_created ON raffles(created_at);
CREATE INDEX IF NOT EXISTS idx_bids_raffle ON bids(raffle_id);
CREATE INDEX IF NOT EXISTS idx_bids_user ON bids(user_telegram_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON star_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON star_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON star_transactions(status);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автообновления updated_at в raffle_settings
CREATE TRIGGER update_raffle_settings_updated_at 
    BEFORE UPDATE ON raffle_settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
`;

const seedDataSQL = `
-- Начальная настройка лотереи
INSERT INTO raffle_settings (required_participants, bid_amount, winner_percentage, admin_percentage)
VALUES (10, 1, 0.70, 0.30)
ON CONFLICT DO NOTHING;
`;

async function setupDatabase() {
  let client;
  
  try {
    client = await pool.connect();
    
    console.log('🔄 Creating database tables...');
    await client.query(createTablesSQL);
    console.log('✅ Tables created successfully');
    
    console.log('🔄 Inserting seed data...');
    await client.query(seedDataSQL);
    console.log('✅ Seed data inserted successfully');
    
    console.log('🔄 Verifying table creation...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📋 Created tables:', result.rows.map(r => r.table_name).join(', '));
    
    console.log('✅ Database setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  setupDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = setupDatabase;