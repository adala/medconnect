// gateway/src/routes/api/syncRoutes.js

const express = require('express');
const router = express.Router();

module.exports = (models, services) => {
    // Force sync
    router.post('/force', async (req, res) => {
        try {
            services.sync.sync().catch(console.error);
            res.json({ success: true, message: 'Sync started' });
        } catch (error) {
            console.error('Force sync error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Get sync status
    router.get('/status', async (req, res) => {
        try {
            const status = services.sync.getStatus();
            res.json({ success: true, data: status });
        } catch (error) {
            console.error('Sync status error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    return router;
};