const fs = require('fs');
const path = require('path');
const winston = require('winston');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '..', '..', 'logs');
        this.ensureLogDirectory();
        this.initLogger();
    }
    
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    initLogger() {
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'portal-global' },
            transports: [
                new winston.transports.File({ 
                    filename: path.join(this.logDir, 'error.log'),
                    level: 'error' 
                }),
                new winston.transports.File({ 
                    filename: path.join(this.logDir, 'combined.log') 
                })
            ]
        });

        // Add console transport in development
        if (process.env.NODE_ENV !== 'production') {
            this.logger.add(new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            }));
        }
    }
    
    log(level, message, meta = {}) {
        this.logger.log(level, message, meta);
    }
    
    info(message, meta = {}) {
        this.log('info', message, meta);
    }
    
    error(message, error) {
        this.log('error', message, { 
            error: error?.message || String(error),
            stack: error?.stack 
        });
    }
    
    warn(message, meta = {}) {
        this.log('warn', message, meta);
    }
    
    debug(message, meta = {}) {
        if (process.env.NODE_ENV === 'development') {
            this.log('debug', message, meta);
        }
    }
    
    // Request logging middleware
    requestLogger() {
        return (req, res, next) => {
            const start = Date.now();
            
            res.on('finish', () => {
                const duration = Date.now() - start;
                const logData = {
                    method: req.method,
                    url: req.url,
                    status: res.statusCode,
                    duration,
                    userAgent: req.get('User-Agent'),
                    ip: req.ip || req.connection.remoteAddress,
                    userId: req.user?.id
                };
                
                if (res.statusCode >= 500) {
                    this.error(`Request failed: ${req.method} ${req.url}`, logData);
                } else if (res.statusCode >= 400) {
                    this.warn(`Request warning: ${req.method} ${req.url}`, logData);
                } else {
                    this.info(`Request completed: ${req.method} ${req.url}`, logData);
                }
            });
            
            next();
        };
    }
    
    // Error logging middleware
    errorLogger() {
        return (err, req, res, next) => {
            this.error('Unhandled error', {
                error: err.message,
                stack: err.stack,
                method: req.method,
                url: req.url,
                userId: req.user?.id
            });
            next(err);
        };
    }
}

module.exports = new Logger();
