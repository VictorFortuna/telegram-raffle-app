# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram Raffle Stars is a comprehensive lottery system built as a Telegram Mini App with Telegram Stars integration. The application allows users to participate in raffles using Telegram Stars as currency, with automatic winner selection and prize distribution.

## Architecture

### Backend (Node.js + Express)
- **Server**: `server.js` - Main application entry point with Express server and Socket.IO
- **Database**: PostgreSQL with connection pooling via `src/services/databaseService.js`
- **Models**: `src/models/` - Database models (User, Raffle, RaffleSettings)
- **Routes**: `src/routes/` - API endpoints organized by feature
- **Services**: `src/services/` - Business logic (telegramService, socketService)
- **Middleware**: `src/middleware/` - Authentication, rate limiting, error handling

### Frontend (Vanilla JavaScript + Telegram Mini App)
- **Mini App**: `public/index.html` - Main user interface
- **Admin Panel**: `public/admin.html` - Administrative interface
- **JavaScript**: Modular client-side code in `public/js/`
- **Styles**: Custom CSS with Telegram Mini App optimizations

### Database Schema
Core tables: users, raffles, raffle_settings, bids, star_transactions, audit_logs
Setup via: `scripts/setup-database.js`

## Development Commands

### Essential Commands
```bash
npm install              # Install dependencies
npm run dev             # Development server with auto-reload
npm start               # Production server
npm run setup-db        # Initialize database schema
npm run seed-db         # Populate with test data
npm run lint            # ESLint code checking
npm run typecheck       # TypeScript checking (if applicable)
npm test                # Run test suite
npm run build           # Lint + typecheck for production readiness
```

### Database Management
```bash
node scripts/setup-database.js    # Create tables and indexes
node scripts/seed-database.js     # Add sample data
```

## Key Configuration

### Environment Variables (Required)
- `DATABASE_URL`: PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `JWT_SECRET`: Secret for JWT token signing
- `ADMIN_PASSWORD_HASH`: Bcrypt hash for admin login
- `PORT`: Server port (default: 3000)

### Development Setup
1. Create PostgreSQL database
2. Copy `.env.example` to `.env` and configure
3. Run `npm run setup-db` to initialize schema
4. Start development server with `npm run dev`

## Code Architecture Patterns

### API Structure
- **Routes**: RESTful endpoints in `src/routes/`
- **Authentication**: JWT middleware in `src/routes/auth.js`
- **Error Handling**: Centralized in `src/middleware/errorHandler.js`
- **Rate Limiting**: Configurable limits in `src/middleware/rateLimiter.js`

### Database Patterns
- **Connection Pooling**: Managed via `databaseService.js`
- **Transactions**: Database transactions for critical operations
- **Models**: Active Record pattern with business logic methods
- **Migrations**: Schema changes tracked in setup scripts

### Real-time Communication
- **WebSockets**: Socket.IO for live updates
- **Events**: Structured event system for raffle updates
- **Broadcasting**: User notifications and system messages

### Security Measures
- JWT authentication for API access
- Rate limiting per endpoint type
- Input validation and sanitization
- Audit logging for admin actions
- Encrypted sensitive data storage

## Testing Strategy

### Test Structure
- **Unit Tests**: Model and service logic
- **Integration Tests**: API endpoint behavior
- **E2E Tests**: Full user workflows
- **Load Tests**: WebSocket and concurrent user handling

### Mock Services
- Telegram API calls mocked in development
- Database transactions can be rolled back in tests
- WebSocket events can be simulated

## Deployment (Railway)

### Files
- `Dockerfile`: Production container configuration
- `railway.json`: Railway deployment settings
- `.dockerignore`: Files excluded from container

### Process
1. Configure environment variables in Railway
2. Add PostgreSQL service
3. Deploy via `railway up`
4. Run database setup in production environment

## Telegram Integration

### Bot Setup
- Create bot via @BotFather
- Configure Menu Button for Mini App
- Enable Telegram Stars payments
- Set webhook URL for payment notifications

### Mini App Configuration
- Served from root `/` route
- Telegram WebApp API integration
- Real-time updates via WebSocket
- Payment flow through Telegram Stars

## Admin Panel Features

### Access
- URL: `/admin`
- Authentication: Username/password
- Session management: JWT tokens

### Capabilities
- Raffle management (create, cancel, view)
- Settings configuration (participants, bid amounts, percentages)
- User monitoring and statistics
- System health monitoring
- Audit log viewing

## Common Development Tasks

### Adding New API Endpoint
1. Create route handler in appropriate `src/routes/` file
2. Add authentication middleware if required
3. Implement business logic in service layer
4. Add database queries in model methods
5. Include error handling and validation

### Modifying Database Schema
1. Update `scripts/setup-database.js` with schema changes
2. Modify relevant model files in `src/models/`
3. Update any affected API endpoints
4. Test migration on development database

### Adding WebSocket Events
1. Define event in `socketService.js`
2. Add client-side handler in `public/js/socket.js`
3. Update UI accordingly in `public/js/ui.js`
4. Test real-time functionality

## Error Handling and Logging

### Server Errors
- Centralized error handler with unique error IDs
- Structured logging with correlation IDs
- Admin notifications for critical errors
- Graceful degradation for external service failures

### Client Errors
- User-friendly error messages
- Automatic retry mechanisms for network issues
- Offline state handling
- WebSocket reconnection logic

## Performance Considerations

### Database
- Connection pooling for concurrent requests
- Indexed queries for frequent operations
- Pagination for large result sets
- Read replicas for analytics queries (future)

### WebSocket
- Connection management and cleanup
- Message queuing for offline users
- Rate limiting for socket events
- Heartbeat monitoring

### Caching
- Redis integration for session storage (optional)
- In-memory caching for frequently accessed data
- CDN for static assets (production)

## Security Best Practices

### Data Protection
- No sensitive data in logs or client code
- Encrypted storage of payment information
- HTTPS enforcement in production
- Input sanitization on all endpoints

### Access Control
- Role-based permissions (user/admin)
- API rate limiting per user
- Session timeout and cleanup
- Secure cookie configuration

This architecture supports a scalable, maintainable lottery system with real-time features and comprehensive administrative controls.