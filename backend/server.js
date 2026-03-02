const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// ========== MIDDLEWARE ==========
app.use(helmet({
    contentSecurityPolicy: false // Упрощаем для локальной разработки
}));

app.use(compression());
app.use(morgan("dev"));
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting for API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
});
app.use("/legacy", express.static(path.join(__dirname, "html")));

// ========== API ROUTES ==========
const apiRoutes = express.Router();

// Health check
apiRoutes.get("/health", (req, res) => {
    res.json({
        ok: true,
        ts: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || "development"
    });
});

// AI Project Generation
apiRoutes.post("/ai-project", (req, res) => {
    const { idea } = req.body || {};

    if (!idea || idea.trim().length < 3) {
        return res.status(400).json({
            error: "Invalid idea",
            message: "Idea must be at least 3 characters long"
        });
    }

    const projectName = String(idea)
        .split(/\s+/)
        .slice(0, 3)
        .join(" ") + " Platform";

    const adjectives = ["Modern", "Scalable", "Enterprise", "Cloud", "AI-Powered"];
    const techStacks = ["MERN", "Jamstack", "Microservices", "Serverless"];
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomTech = techStacks[Math.floor(Math.random() * techStacks.length)];

    res.json({
        success: true,
        projectName: `${randomAdjective} ${projectName}`,
        timeline: `${Math.floor(Math.random() * 3) + 2}-${Math.floor(Math.random() * 4) + 4} months`,
        teamSize: `${Math.floor(Math.random() * 5) + 3}-${Math.floor(Math.random() * 5) + 6}`,
        budget: `$${(Math.floor(Math.random() * 100) + 50)},000 - $${(Math.floor(Math.random() * 100) + 75)},000`,
        techStack: randomTech,
        risk: ["Low", "Medium", "High"][Math.floor(Math.random() * 3)],
        recommendations: [
            "Start with MVP and user testing",
            "Use agile development with 2-week sprints",
            "Implement CI/CD pipeline from day one",
            "Focus on core user flows first",
            "Plan for scalability from architecture phase"
        ]
    });
});

// Chat API
apiRoutes.post("/chat", async (req, res) => {
    try {
        const { message } = req.body || {};

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: "Invalid message",
                message: "Message cannot be empty"
            });
        }

        // Simulate AI processing delay
        await new Promise(resolve => setTimeout(resolve, 300));

        const responses = [
            `I understand you're asking about "${message}". In our portal, you can:`,
            `Thanks for your query about "${message}". Here's what I can help with:`,
            `Regarding "${message}", our portal supports the following actions:`
        ];

        const randomResponse = responses[Math.floor(Math.random() * responses.length)];

        res.json({
            success: true,
            reply: `${randomResponse}\n1. Project planning and estimation\n2. Team allocation and resource management\n3. Client communication and reporting\n4. Technical implementation guidance\n5. Compliance and documentation support`,
            suggestions: [
                "Generate project timeline",
                "Estimate budget requirements",
                "Assign team members",
                "Create compliance checklist",
                "Set up client reporting"
            ],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Chat error:", error);
        res.status(500).json({
            error: "Internal server error",
            message: "Failed to process chat request"
        });
    }
});

// System Statistics
apiRoutes.get("/stats", (req, res) => {
    const stats = {
        totalProjects: Math.floor(Math.random() * 50) + 20,
        activeOrders: Math.floor(Math.random() * 15) + 5,
        clients: Math.floor(Math.random() * 100) + 50,
        providers: Math.floor(Math.random() * 30) + 10,
        aiRequests: Math.floor(Math.random() * 1000) + 500,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    };

    res.json({ success: true, ...stats });
});

// Mount API routes with rate limiting
app.use("/api", apiLimiter, apiRoutes);

// ========== STATIC FILES ==========
app.use("/static", express.static(path.join(__dirname, "public"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "public, max-age=0");
        }
    }
}));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ========== HTML PAGES ==========
// Helper function to read and send HTML with proper encoding
async function sendHTML(res, filename, title = "PORTAL GLOBAL") {
    try {
        const html = await fs.readFile(filename, "utf-8");

        // Ensure UTF-8 encoding
        res.setHeader("Content-Type", "text/html; charset=utf-8");

        // Inject meta charset if missing
        let finalHtml = html;
        if (!html.includes('charset="utf-8"') && !html.includes("charset=utf-8")) {
            finalHtml = html.replace(
                /<head>/i,
                '<head>\n<meta charset="UTF-8">'
            );
        }

        res.send(finalHtml);
    } catch (error) {
        console.error(`Error reading ${filename}:`, error);
        res.status(404).send(`<h1>Page not found</h1><p>File ${path.basename(filename)} does not exist.</p>`);
    }
}

// Main routes
app.get("/", (req, res) => {
    res.redirect(301, "/dashboard");
});

// Serve index.html for all portal routes (SPA approach)
const portalRoutes = ["dashboard", "projects", "ai", "orders", "pricing", "clients", "providers", "compliance", "account", "cabinet"];

portalRoutes.forEach(route => {
    app.get(`/${route}`, async (req, res) => {
        const indexPath = path.join(__dirname, "index.html");
        await sendHTML(res, indexPath);
    });
});

// Serve individual HTML files
app.get("/html/:filename", async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "html", filename);
    await sendHTML(res, filePath);
});

// ========== PRODUCTION MODE ==========
if (process.env.NODE_ENV === "production") {
  const buildPath = path.join(__dirname, "..", "frontend", "build");
  app.use(express.static(buildPath));

  app.get("/*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/legacy")) return next();
    res.sendFile(path.join(buildPath, "index.html"));
  });
}

// ========== ERROR HANDLING ==========
app.use((req, res, next) => {
    res.status(404).json({
        error: "Not Found",
        message: `Route ${req.originalUrl} not found`,
        availableRoutes: [
            "/dashboard",
            "/projects",
            "/ai",
            "/orders",
            "/pricing",
            "/clients",
            "/providers",
            "/compliance",
            "/account",
            "/cabinet",
            "/api/health",
            "/api/chat",
            "/api/ai-project",
            "/api/stats"
        ]
    });
});

app.use((err, req, res, next) => {
    console.error("Server error:", err);

    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message;

    res.status(statusCode).json({
        error: "Server Error",
        message,
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack })
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
    console.log(`
╔═══════════════════════════════════════╗
║      PORTAL GLOBAL SERVER             ║
╠═══════════════════════════════════════╣
║  URL: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  ║
║  Environment: ${process.env.NODE_ENV || "development"}        ║
║  PID: ${process.pid}                                ║
╚═══════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

process.on("SIGINT", () => {
    console.log("SIGINT received. Shutting down...");
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

module.exports = { app, server };
