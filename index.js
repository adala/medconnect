// index.js - Main entry point for Railway
console.log('='.repeat(60));
console.log('🚀 Medconnect Gateway Starting...');
console.log('='.repeat(60));
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());
console.log('Environment:', process.env.NODE_ENV || 'production');
console.log('PORT:', process.env.PORT || 8080);

// Load environment variables
require('dotenv').config();

// Import express
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 8080;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (always works)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        version: process.version,
        pid: process.pid
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Medconnect Gateway',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            dashboard: '/dashboard'
        }
    });
});

// Simple dashboard
app.get('/dashboard', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Medconnect Gateway</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                    max-width: 800px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f5f5;
                }
                .card {
                    background: white;
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #333; margin-top: 0; }
                .status { color: #28a745; font-weight: bold; }
                pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🏥 Medconnect Gateway</h1>
                <p>Status: <span class="status">✅ Running</span></p>
                <p>Version: 1.0.0</p>
                <p>Uptime: ${Math.floor(process.uptime())} seconds</p>
                <p>Environment: ${process.env.NODE_ENV || 'production'}</p>
            </div>
            <div class="card">
                <h2>📊 System Information</h2>
                <pre>${JSON.stringify({
                    node: process.version,
                    platform: process.platform,
                    memory: {
                        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
                        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
                        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
                    },
                    port: port,
                    pid: process.pid
                }, null, 2)}</pre>
            </div>
        </body>
        </html>
    `);
});

// Try to load additional routes if they exist
const routesPath = path.join(__dirname, 'src/routes');
if (fs.existsSync(routesPath)) {
    console.log('📁 Found routes directory, loading additional routes...');
    try {
        // Try to load web routes if they exist
        const webRoutesPath = path.join(routesPath, 'web');
        if (fs.existsSync(webRoutesPath)) {
            const webRoutes = require('./src/routes/web');
            if (typeof webRoutes === 'function') {
                app.use('/', webRoutes);
                console.log('✅ Web routes loaded');
            }
        }
        
        // Try to load API routes
        const apiRoutesPath = path.join(routesPath, 'api');
        if (fs.existsSync(apiRoutesPath)) {
            const apiRoutes = require('./src/routes/api');
            if (typeof apiRoutes === 'function') {
                app.use('/api', apiRoutes);
                console.log('✅ API routes loaded');
            }
        }
    } catch (err) {
        console.error('Failed to load routes:', err.message);
    }
} else {
    console.log('ℹ️  No additional routes found, running in minimal mode');
}

// Start server
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`📍 Health check: http://localhost:${port}/health`);
    console.log(`📍 Dashboard: http://localhost:${port}/dashboard`);
    console.log('='.repeat(60));
});

// Error handling
server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

console.log('Application ready, waiting for requests...');