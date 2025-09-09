const express = require('express');
const User = require('../models/User');
const Raffle = require('../models/Raffle');
const socketService = require('../services/socketService');

const router = express.Router();

// Глобальная статистика (публичная)
router.get('/global', async (req, res, next) => {
  try {
    const db = require('../services/databaseService');

    // Получаем основную статистику параллельно
    const [
      totalUsersResult,
      totalRafflesResult,
      totalPrizesResult,
      activeUsersResult,
      currentRaffleResult
    ] = await Promise.all([
      // Всего пользователей
      db.query('SELECT COUNT(*) as count FROM users'),
      
      // Всего завершенных лотерей
      db.query('SELECT COUNT(*) as count FROM raffles WHERE status = $1', ['completed']),
      
      // Общая сумма выданных призов
      db.query('SELECT SUM(winner_prize) as total FROM raffles WHERE status = $1', ['completed']),
      
      // Активные пользователи за последние 24 часа
      db.query(
        'SELECT COUNT(*) as count FROM users WHERE last_active > NOW() - INTERVAL \'24 hours\''
      ),
      
      // Информация о текущей лотерее
      db.query(`
        SELECT 
          r.*,
          COUNT(b.id) as current_participants_count
        FROM raffles r
        LEFT JOIN bids b ON r.id = b.raffle_id AND b.status = 'confirmed'
        WHERE r.status = 'active'
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 1
      `)
    ]);

    // Топ-5 недавних победителей
    const recentWinners = await db.query(`
      SELECT 
        r.id as raffle_id,
        r.winner_prize,
        r.completed_at,
        u.username,
        u.first_name
      FROM raffles r
      JOIN users u ON r.winner_telegram_id = u.telegram_id
      WHERE r.status = 'completed'
      ORDER BY r.completed_at DESC
      LIMIT 5
    `);

    // Статистика по дням за последнюю неделю
    const weeklyStats = await db.query(`
      SELECT 
        DATE(completed_at) as date,
        COUNT(*) as raffles_completed,
        SUM(winner_prize) as prizes_distributed,
        SUM(current_participants) as total_participants
      FROM raffles 
      WHERE status = 'completed' 
        AND completed_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(completed_at)
      ORDER BY date DESC
    `);

    // Подключения в реальном времени
    const connectionStats = socketService.getConnectionStats();

    const globalStats = {
      total_users: parseInt(totalUsersResult.rows[0].count),
      active_users_24h: parseInt(activeUsersResult.rows[0].count),
      total_raffles_completed: parseInt(totalRafflesResult.rows[0].count),
      total_prizes_distributed: parseInt(totalPrizesResult.rows[0].total) || 0,
      current_raffle: currentRaffleResult.rows.length > 0 ? {
        id: currentRaffleResult.rows[0].id,
        required_participants: currentRaffleResult.rows[0].required_participants,
        current_participants: parseInt(currentRaffleResult.rows[0].current_participants_count),
        total_prize: currentRaffleResult.rows[0].total_prize,
        bid_amount: currentRaffleResult.rows[0].bid_amount,
        created_at: currentRaffleResult.rows[0].created_at
      } : null,
      recent_winners: recentWinners.rows.map(winner => ({
        raffle_id: winner.raffle_id,
        prize: winner.winner_prize,
        winner: {
          username: winner.username || 'Anonymous',
          first_name: winner.first_name || 'User'
        },
        completed_at: winner.completed_at
      })),
      weekly_stats: weeklyStats.rows,
      realtime: {
        active_connections: connectionStats.total_connections,
        authenticated_users: connectionStats.authenticated_users
      },
      last_updated: new Date().toISOString()
    };

    res.json({
      success: true,
      stats: globalStats
    });

  } catch (error) {
    next(error);
  }
});

// Статистика лотерей
router.get('/raffles', async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;
    const db = require('../services/databaseService');

    // Определяем период для статистики
    let intervalCondition;
    switch (period) {
      case '24h':
        intervalCondition = "completed_at > NOW() - INTERVAL '24 hours'";
        break;
      case '7d':
        intervalCondition = "completed_at > NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        intervalCondition = "completed_at > NOW() - INTERVAL '30 days'";
        break;
      case 'all':
        intervalCondition = "1=1";
        break;
      default:
        intervalCondition = "completed_at > NOW() - INTERVAL '7 days'";
    }

    // Статистика по лотереям
    const raffleStats = await db.query(`
      SELECT 
        COUNT(*) as total_raffles,
        AVG(current_participants) as avg_participants,
        MIN(current_participants) as min_participants,
        MAX(current_participants) as max_participants,
        SUM(total_prize) as total_prize_pool,
        SUM(winner_prize) as total_prizes_distributed,
        SUM(admin_fee) as total_admin_fees,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/60) as avg_duration_minutes
      FROM raffles 
      WHERE status = 'completed' AND ${intervalCondition}
    `);

    // Распределение размеров лотерей
    const sizeDistribution = await db.query(`
      SELECT 
        required_participants,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/60) as avg_duration_minutes
      FROM raffles 
      WHERE status = 'completed' AND ${intervalCondition}
      GROUP BY required_participants
      ORDER BY required_participants
    `);

    // Статистика по времени (почасовая для последних 24 часов или ежедневная)
    const timeStats = period === '24h' ? 
      await db.query(`
        SELECT 
          EXTRACT(HOUR FROM completed_at) as hour,
          COUNT(*) as raffles_count,
          SUM(winner_prize) as prizes_sum
        FROM raffles 
        WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'
        GROUP BY EXTRACT(HOUR FROM completed_at)
        ORDER BY hour
      `) :
      await db.query(`
        SELECT 
          DATE(completed_at) as date,
          COUNT(*) as raffles_count,
          SUM(winner_prize) as prizes_sum,
          AVG(current_participants) as avg_participants
        FROM raffles 
        WHERE status = 'completed' AND ${intervalCondition}
        GROUP BY DATE(completed_at)
        ORDER BY date DESC
        LIMIT 30
      `);

    res.json({
      success: true,
      period: period,
      stats: {
        overview: raffleStats.rows[0],
        size_distribution: sizeDistribution.rows,
        time_distribution: timeStats.rows
      }
    });

  } catch (error) {
    next(error);
  }
});

// Статистика пользователей
router.get('/users', async (req, res, next) => {
  try {
    const db = require('../services/databaseService');

    // Общая статистика пользователей
    const userStats = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN last_active > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
        COUNT(CASE WHEN last_active > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d,
        COUNT(CASE WHEN total_bids > 0 THEN 1 END) as users_with_bids,
        COUNT(CASE WHEN total_winnings > 0 THEN 1 END) as users_with_wins,
        AVG(total_bids) as avg_bids_per_user,
        AVG(total_winnings) as avg_winnings_per_user
      FROM users
    `);

    // Распределение пользователей по количеству ставок
    const bidsDistribution = await db.query(`
      SELECT 
        CASE 
          WHEN total_bids = 0 THEN '0'
          WHEN total_bids = 1 THEN '1'
          WHEN total_bids BETWEEN 2 AND 5 THEN '2-5'
          WHEN total_bids BETWEEN 6 AND 10 THEN '6-10'
          WHEN total_bids BETWEEN 11 AND 20 THEN '11-20'
          ELSE '20+' 
        END as bids_range,
        COUNT(*) as users_count
      FROM users
      GROUP BY 
        CASE 
          WHEN total_bids = 0 THEN '0'
          WHEN total_bids = 1 THEN '1'
          WHEN total_bids BETWEEN 2 AND 5 THEN '2-5'
          WHEN total_bids BETWEEN 6 AND 10 THEN '6-10'
          WHEN total_bids BETWEEN 11 AND 20 THEN '11-20'
          ELSE '20+' 
        END
      ORDER BY 
        CASE 
          WHEN bids_range = '0' THEN 0
          WHEN bids_range = '1' THEN 1
          WHEN bids_range = '2-5' THEN 2
          WHEN bids_range = '6-10' THEN 3
          WHEN bids_range = '11-20' THEN 4
          ELSE 5
        END
    `);

    // Новые пользователи за последние 7 дней
    const newUsersDaily = await db.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_users
      FROM users 
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Топ пользователи по выигрышам
    const topWinners = await db.query(`
      SELECT 
        username,
        first_name,
        total_bids,
        total_winnings,
        CASE 
          WHEN total_bids > 0 THEN ROUND((total_winnings::numeric / total_bids::numeric) * 100, 2)
          ELSE 0 
        END as avg_win_per_bid
      FROM users 
      WHERE total_winnings > 0
      ORDER BY total_winnings DESC 
      LIMIT 10
    `);

    res.json({
      success: true,
      stats: {
        overview: userStats.rows[0],
        bids_distribution: bidsDistribution.rows,
        new_users_daily: newUsersDaily.rows,
        top_winners: topWinners.rows.map(user => ({
          username: user.username || 'Anonymous',
          first_name: user.first_name || 'User',
          total_bids: user.total_bids,
          total_winnings: user.total_winnings,
          avg_win_per_bid: parseFloat(user.avg_win_per_bid)
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

// Статистика подключений (WebSocket)
router.get('/connections', async (req, res, next) => {
  try {
    const connectionStats = socketService.getConnectionStats();
    
    res.json({
      success: true,
      connections: connectionStats
    });

  } catch (error) {
    next(error);
  }
});

// Системная статистика
router.get('/system', async (req, res, next) => {
  try {
    const db = require('../services/databaseService');

    // Размеры таблиц
    const tableSizes = await db.query(`
      SELECT 
        schemaname,
        tablename,
        attname,
        n_distinct,
        correlation
      FROM pg_stats 
      WHERE schemaname = 'public'
      ORDER BY tablename, attname
    `);

    // Производительность запросов (если включено логирование)
    const systemInfo = {
      database: {
        tables: tableSizes.rows
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version,
        platform: process.platform
      },
      environment: {
        node_env: process.env.NODE_ENV,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    };

    res.json({
      success: true,
      system: systemInfo
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;