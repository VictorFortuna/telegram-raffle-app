const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const redis = require('redis');

// Настройка Redis для production
let redisClient = null;
if (process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
  try {
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.warn('Redis connection error:', err));
    redisClient.connect();
  } catch (error) {
    console.warn('Failed to connect to Redis, using memory rate limiter:', error);
  }
}

// Общий лимитер для API запросов
const generalLimiter = redisClient
  ? new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'general_rl',
      points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 || 60,
      blockDuration: 60,
    })
  : new RateLimiterMemory({
      keyPrefix: 'general_rl',
      points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 || 60,
      blockDuration: 60,
    });

// Строгий лимитер для ставок
const bidLimiter = redisClient
  ? new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'bid_rl',
      points: 5, // максимум 5 попыток ставки
      duration: 60, // за 60 секунд
      blockDuration: 300, // блокировка на 5 минут
    })
  : new RateLimiterMemory({
      keyPrefix: 'bid_rl',
      points: 5,
      duration: 60,
      blockDuration: 300,
    });

// Лимитер для аутентификации
const authLimiter = redisClient
  ? new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'auth_rl',
      points: 10, // максимум 10 попыток авторизации
      duration: 60, // за 60 секунд
      blockDuration: 600, // блокировка на 10 минут
    })
  : new RateLimiterMemory({
      keyPrefix: 'auth_rl',
      points: 10,
      duration: 60,
      blockDuration: 600,
    });

// Лимитер для админских операций
const adminLimiter = redisClient
  ? new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'admin_rl',
      points: 30, // больше запросов для админов
      duration: 60,
      blockDuration: 60,
    })
  : new RateLimiterMemory({
      keyPrefix: 'admin_rl',
      points: 30,
      duration: 60,
      blockDuration: 60,
    });

// Функция получения ключа для rate limiting
function getClientKey(req) {
  // Приоритет: telegram_id > IP адрес
  if (req.user && req.user.telegram_id) {
    return `user_${req.user.telegram_id}`;
  }
  
  return req.ip || req.connection.remoteAddress || 'unknown';
}

// Основной middleware для rate limiting
function createRateLimitMiddleware(limiter, skipSuccessfulRequests = false) {
  return async (req, res, next) => {
    try {
      const key = getClientKey(req);
      
      await limiter.consume(key);
      next();
    } catch (rejRes) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      
      res.set('Retry-After', String(secs));
      res.set('X-RateLimit-Limit', limiter.points);
      res.set('X-RateLimit-Remaining', rejRes.remainingPoints || 0);
      res.set('X-RateLimit-Reset', new Date(Date.now() + rejRes.msBeforeNext));

      const error = new Error('Превышен лимит запросов. Попробуйте позже.');
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.statusCode = 429;
      
      next(error);
    }
  };
}

// Middleware для разных типов запросов
const rateLimiters = {
  // Общий лимитер (применяется ко всем запросам)
  general: createRateLimitMiddleware(generalLimiter),
  
  // Строгий лимитер для ставок
  bids: createRateLimitMiddleware(bidLimiter),
  
  // Лимитер для авторизации
  auth: createRateLimitMiddleware(authLimiter),
  
  // Лимитер для админских операций
  admin: createRateLimitMiddleware(adminLimiter),
};

// Middleware по умолчанию
function defaultRateLimiter(req, res, next) {
  // Пропускаем статические файлы и health check
  if (req.path.startsWith('/public/') || 
      req.path === '/health' || 
      req.path === '/favicon.ico') {
    return next();
  }

  // Применяем соответствующий лимитер
  if (req.path.includes('/api/raffle/bid')) {
    return rateLimiters.bids(req, res, next);
  }
  
  if (req.path.includes('/api/auth/')) {
    return rateLimiters.auth(req, res, next);
  }
  
  if (req.path.includes('/api/admin/')) {
    return rateLimiters.admin(req, res, next);
  }

  // Общий лимитер для всех остальных API запросов
  if (req.path.startsWith('/api/')) {
    return rateLimiters.general(req, res, next);
  }

  // Пропускаем без лимитов для не-API запросов
  next();
}

// Функция для сброса лимитов пользователя (админская)
async function resetUserLimits(telegramId) {
  const key = `user_${telegramId}`;
  const limiters = [generalLimiter, bidLimiter, authLimiter, adminLimiter];
  
  const results = await Promise.allSettled(
    limiters.map(limiter => limiter.delete(key))
  );
  
  return results.every(result => result.status === 'fulfilled');
}

// Функция для получения статуса лимитов пользователя
async function getUserLimitStatus(telegramId) {
  const key = `user_${telegramId}`;
  
  try {
    const [general, bid, auth] = await Promise.all([
      generalLimiter.get(key),
      bidLimiter.get(key),
      authLimiter.get(key),
    ]);

    return {
      general: {
        remaining: general ? general.remainingPoints : generalLimiter.points,
        reset: general ? new Date(Date.now() + general.msBeforeNext) : null,
      },
      bids: {
        remaining: bid ? bid.remainingPoints : bidLimiter.points,
        reset: bid ? new Date(Date.now() + bid.msBeforeNext) : null,
      },
      auth: {
        remaining: auth ? auth.remainingPoints : authLimiter.points,
        reset: auth ? new Date(Date.now() + auth.msBeforeNext) : null,
      },
    };
  } catch (error) {
    console.error('Error getting user limit status:', error);
    return null;
  }
}

// Middleware для добавления заголовков с информацией о лимитах
function addLimitHeaders(req, res, next) {
  const originalSend = res.send;
  
  res.send = async function(data) {
    try {
      const key = getClientKey(req);
      const limitInfo = await generalLimiter.get(key);
      
      if (limitInfo) {
        res.set('X-RateLimit-Remaining', String(limitInfo.remainingPoints));
        res.set('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + limitInfo.msBeforeNext / 1000));
      }
    } catch (error) {
      // Игнорируем ошибки получения информации о лимитах
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

// Функция для блокировки IP адреса (админская)
async function blockIP(ip, durationSeconds = 3600) {
  try {
    const blocker = redisClient
      ? new RateLimiterRedis({
          storeClient: redisClient,
          keyPrefix: 'ip_block',
          points: 1,
          duration: 1,
          blockDuration: durationSeconds,
        })
      : new RateLimiterMemory({
          keyPrefix: 'ip_block',
          points: 1,
          duration: 1,
          blockDuration: durationSeconds,
        });

    await blocker.block(ip, durationSeconds);
    return true;
  } catch (error) {
    console.error('Error blocking IP:', error);
    return false;
  }
}

module.exports = {
  // Основной middleware
  default: defaultRateLimiter,
  
  // Специфичные лимитеры
  general: rateLimiters.general,
  bids: rateLimiters.bids,
  auth: rateLimiters.auth,
  admin: rateLimiters.admin,
  
  // Утилиты
  resetUserLimits,
  getUserLimitStatus,
  addLimitHeaders,
  blockIP,
};