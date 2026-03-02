const { initDatabase } = require('./database/init');

// Initialize database when server starts
initDatabase().catch(console.error);