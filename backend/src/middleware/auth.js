# PORTAL GLOBAL - Унифицированный Портал Управления

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Express](https://img.shields.io/badge/Express-4.x-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

**PORTAL GLOBAL** — это унифицированная платформа для управления проектами, клиентами, поставщиками и AI-ассистентом в едином интерфейсе.

## 🚀 Быстрый старт

### Предварительные требования
- Node.js 18 или выше
- npm 8 или выше

### Установка
```bash
# Клонирование репозитория
git clone <repository-url>
cd portal-global\backend

# Установка зависимостей
npm install

# Запуск сервера
npm start

# Или запуск в режиме разработки
npm run dev
# Создание AI проекта
curl -X POST http://localhost:3000/api/ai-project \
  -H "Content-Type: application/json" \
  -d '{"idea": "Создание платформы для онлайн-обучения"}'
# Запуск сервера
npm start

# Запуск в режиме разработки с hot-reload
npm run dev

# Исправление проблем с кодировкой
npm run fix:encoding

# Анализ UI компонентов
npm run extract:ui <file1.html> <file2.html>

# Генерация карты интерфейса
npm run build:map
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
@'
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "portal-global-secret-key";

const authMiddleware = {
    authenticate: (req, res, next) => {
        const token = req.headers.authorization?.replace("Bearer ", "");
        
        if (!token) {
            return res.status(401).json({ error: "Authentication required" });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            res.status(401).json({ error: "Invalid token" });
        }
    },
    
    authorize: (...roles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: "Authentication required" });
            }
            
            if (roles.length && !roles.includes(req.user.role)) {
                return res.status(403).json({ error: "Insufficient permissions" });
            }
            
            next();
        };
    }
};

module.exports = authMiddleware;
