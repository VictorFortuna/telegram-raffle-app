require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Import services first (before routes that depend on them)
const databaseService = require('./src/services/databaseService');
const socketService = require('./src/services/socketService');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://telegram.org"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"]
    }
  }
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple rate limiting middleware instead of external module
const rateLimitMap = new Map();
const rateLimit = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 100;
  
  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  const clientData = rateLimitMap.get(clientIP);
  if (now > clientData.resetTime) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + windowMs });
    return next();
  }
  
  if (clientData.count >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  clientData.count++;
  next();
};

app.use(rateLimit);

// Serve static files (Mini App frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Import and use routes after middleware setup
try {
  const authRoutes = require('./src/routes/auth');
  const userRoutes = require('./src/routes/user');
  const raffleRoutes = require('./src/routes/raffle');
  const adminRoutes = require('./src/routes/admin');
  const statsRoutes = require('./src/routes/stats');
  const webhookRoutes = require('./src/routes/webhook');

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/raffle', raffleRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/webhook', webhookRoutes);
} catch (error) {
  console.error('Error loading routes:', error.message);
  // Continue without problematic routes for now
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Serve Mini App
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Socket.IO initialization
try {
  socketService.initialize(io);
} catch (error) {
  console.error('Socket service initialization failed:', error.message);
}

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Something went wrong' 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'NOT_FOUND', 
    message: 'Endpoint not found' 
  });
});

// Initialize database connection
async function startServer() {
  try {
    // Test database connection
    await databaseService.testConnection();
    console.log('Database connection established');

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Mini App available at: http://localhost:${PORT}`);
      console.log(`Admin panel at: http://localhost:${PORT}/admin`);
      console.log(`Health check at: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    // Don't exit, try to start anyway
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT} (database connection failed)`);
    });
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    try {
      await databaseService.closeConnection();
    } catch (error) {
      console.error('Error closing database:', error);
    }
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(async () => {
    try {
      await databaseService.closeConnection();
    } catch (error) {
      console.error('Error closing database:', error);
    }
    process.exit(0);
  });
});

startServer();
