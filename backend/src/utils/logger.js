const fs = require("fs");
const path = require("path");

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, "..", "..", "logs");
        this.ensureLogDirectory();
    }
    
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    getLogFile() {
        const date = new Date().toISOString().split("T")[0];
        return path.join(this.logDir, `${date}.log`);
    }
    
    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data
        };
        
        // Console output
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
        
        // File output
        const logLine = JSON.stringify(logEntry) + "\n";
        fs.appendFileSync(this.getLogFile(), logLine, "utf8");
    }
    
    info(message, data) {
        this.log("info", message, data);
    }
    
    error(message, error) {
        this.log("error", message, { 
            error: error?.message || String(error),
            stack: error?.stack 
        });
    }
    
    warn(message, data) {
        this.log("warn", message, data);
    }
    
    debug(message, data) {
        if (process.env.NODE_ENV === "development") {
            this.log("debug", message, data);
        }
    }
}

module.exports = new Logger();
