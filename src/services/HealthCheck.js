// gateway/src/services/HealthCheck.js

const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

class HealthCheck {
    constructor({ services, port = 9090 }) {
        this.services = services;
        this.port = port;
        this.startTime = Date.now();
        this.checkInterval = null;
        this.metricsServer = null;
    }

    async start(interval = 60000) {
        console.log('📊 Health check service starting...');
        
        // Perform initial health check
        await this.check();
        
        // Schedule regular checks
        this.checkInterval = setInterval(() => this.check(), interval);
        
        // Start metrics server if enabled
        if (this.port) {
            this.startMetricsServer();
        }
    }

    async check() {
        try {
            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: this.getUptime(),
                services: await this.checkServices(),
                system: await this.getSystemHealth(),
                storage: await this.getStorageHealth(),
                sync: this.getSyncHealth(),
                warnings: []
            };

            // Check for warnings
            if (health.system.memory.usagePercent > 90) {
                health.warnings.push('High memory usage');
                health.status = 'warning';
            }

            if (health.storage?.data?.usedPercent > 90) {
                health.warnings.push('Low disk space for data directory');
                health.status = 'warning';
            }

            if (health.storage?.drop?.usedPercent > 90) {
                health.warnings.push('Low disk space for drop folder');
                health.status = 'warning';
            }

            if (health.sync.pendingRecords > 1000) {
                health.warnings.push('Large sync backlog');
                health.status = 'warning';
            }

            // Check critical services
            if (!health.services.database || !health.services.deviceWatcher) {
                health.status = 'unhealthy';
                health.warnings.push('Critical service down');
            }

            // Log health status if changed
            if (this.lastStatus !== health.status) {
                console.log(`📊 Health status: ${health.status}`);
                this.lastStatus = health.status;
            }

            return health;

        } catch (error) {
            console.error('Health check failed:', error);
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    async checkServices() {
        const services = {};

        // Check database
        try {
            if (this.services.db) {
                await this.services.db.get('SELECT 1');
                services.database = true;
            } else {
                services.database = false;
            }
        } catch {
            services.database = false;
        }

        // Check device watcher
        services.deviceWatcher = this.services.deviceWatcher?.isRunning || false;

        // Check sync service
        services.sync = this.services.sync?.isSyncing !== undefined;

        // Check HL7 service
        services.hl7 = this.services.hl7?.isRunning || false;

        // Check encryption
        services.encryption = !!this.services.encryption;

        return services;
    }

    async getSystemHealth() {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();
        
        // Calculate CPU usage percentage
        const cpuUsage = cpus.length > 0 ? (loadAvg[0] / cpus.length) * 100 : 0;
        
        // Memory info
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: {
                count: cpus.length,
                model: cpus[0]?.model || 'Unknown',
                loadAvg: loadAvg.map(l => parseFloat(l.toFixed(2))),
                usagePercent: parseFloat(cpuUsage.toFixed(2))
            },
            memory: {
                total: this.formatBytes(totalMem),
                free: this.formatBytes(freeMem),
                used: this.formatBytes(usedMem),
                usagePercent: parseFloat((usedMem / totalMem * 100).toFixed(2))
            },
            uptime: this.formatUptime(os.uptime())
        };
    }

    async getStorageHealth() {
        try {
            // Get data directory path
            const dataPath = this.services.db?.path || path.join(process.cwd(), 'data');
            const dropPath = process.env.DROP_FOLDER || path.join(process.cwd(), 'drop-folder');

            // Get disk usage for data directory
            const dataStats = await this.getDiskUsage(dataPath);
            
            // Get disk usage for drop folder
            const dropStats = await this.getDiskUsage(dropPath);
            
            return {
                data: {
                    path: dataPath,
                    available: this.formatBytes(dataStats.available),
                    total: this.formatBytes(dataStats.total),
                    used: this.formatBytes(dataStats.used),
                    usedPercent: parseFloat(dataStats.usedPercent.toFixed(2))
                },
                drop: {
                    path: dropPath,
                    available: this.formatBytes(dropStats.available),
                    total: this.formatBytes(dropStats.total),
                    used: this.formatBytes(dropStats.used),
                    usedPercent: parseFloat(dropStats.usedPercent.toFixed(2))
                }
            };
        } catch (error) {
            console.error('Storage check failed:', error);
            return {
                error: error.message,
                data: { usedPercent: 0 },
                drop: { usedPercent: 0 }
            };
        }
    }

    async getDiskUsage(directory) {
        try {
            // Ensure directory exists
            await fs.mkdir(directory, { recursive: true });
            
            // Get disk stats using fs.statfs (Node.js 18+)
            const stats = await fs.statfs(directory);
            
            const total = stats.blocks * stats.bsize;
            const free = stats.bfree * stats.bsize;
            const available = stats.bavail * stats.bsize;
            const used = total - free;
            const usedPercent = (used / total) * 100;
            
            return { total, free, available, used, usedPercent };
        } catch (error) {
            // Fallback to basic directory size calculation
            console.warn(`Could not get disk stats for ${directory}, using fallback`);
            
            try {
                const files = await fs.readdir(directory);
                let totalSize = 0;
                
                for (const file of files) {
                    const filePath = path.join(directory, file);
                    const stat = await fs.stat(filePath);
                    if (stat.isFile()) {
                        totalSize += stat.size;
                    }
                }
                
                // Assume 100GB total for fallback
                const total = 100 * 1024 * 1024 * 1024; // 100GB
                const used = totalSize;
                const usedPercent = (used / total) * 100;
                
                return {
                    total,
                    free: total - used,
                    available: total - used,
                    used,
                    usedPercent
                };
            } catch (fallbackError) {
                // Return default values if all else fails
                return {
                    total: 100 * 1024 * 1024 * 1024,
                    free: 90 * 1024 * 1024 * 1024,
                    available: 90 * 1024 * 1024 * 1024,
                    used: 10 * 1024 * 1024 * 1024,
                    usedPercent: 10
                };
            }
        }
    }

    getSyncHealth() {
        const syncService = this.services.sync;
        
        return {
            isSyncing: syncService?.isSyncing || false,
            isConnected: syncService?.isConnected || false,
            lastSync: syncService?.status?.lastSync,
            lastSyncStatus: syncService?.status?.lastSyncStatus,
            totalSynced: syncService?.status?.totalSynced || 0,
            pendingRecords: this.getPendingSyncCount(),
            errors: syncService?.status?.errors || 0
        };
    }

    getPendingSyncCount() {
        try {
            // This would query the database for pending sync count
            // Placeholder - implement based on your database model
            return 0;
        } catch (error) {
            return 0;
        }
    }

    startMetricsServer() {
        const app = express();

        // Metrics endpoint for Prometheus
        app.get('/metrics', async (req, res) => {
            try {
                const health = await this.check();
                
                let metrics = '';
                
                // System metrics
                metrics += `# HELP system_uptime_seconds System uptime in seconds\n`;
                metrics += `# TYPE system_uptime_seconds gauge\n`;
                metrics += `system_uptime_seconds ${health.uptime?.seconds || 0}\n\n`;
                
                metrics += `# HELP system_memory_usage_bytes Memory usage in bytes\n`;
                metrics += `# TYPE system_memory_usage_bytes gauge\n`;
                metrics += `system_memory_usage_bytes{type="used"} ${os.totalmem() - os.freemem()}\n`;
                metrics += `system_memory_usage_bytes{type="total"} ${os.totalmem()}\n`;
                metrics += `system_memory_usage_bytes{type="free"} ${os.freemem()}\n\n`;
                
                metrics += `# HELP system_cpu_usage_percent CPU usage percentage\n`;
                metrics += `# TYPE system_cpu_usage_percent gauge\n`;
                metrics += `system_cpu_usage_percent ${health.system?.cpu?.usagePercent || 0}\n\n`;
                
                // Service status
                for (const [service, status] of Object.entries(health.services || {})) {
                    metrics += `# HELP service_status Service status (1=up, 0=down)\n`;
                    metrics += `# TYPE service_status gauge\n`;
                    metrics += `service_status{service="${service}"} ${status ? 1 : 0}\n`;
                }
                
                // Sync metrics
                metrics += `\n# HELP sync_pending_records Number of records waiting to sync\n`;
                metrics += `# TYPE sync_pending_records gauge\n`;
                metrics += `sync_pending_records ${health.sync?.pendingRecords || 0}\n`;
                
                metrics += `# HELP sync_total_records Total synced records\n`;
                metrics += `# TYPE sync_total_records counter\n`;
                metrics += `sync_total_records ${health.sync?.totalSynced || 0}\n`;
                
                res.set('Content-Type', 'text/plain');
                res.send(metrics);
            } catch (error) {
                res.status(500).send(`# Error collecting metrics: ${error.message}`);
            }
        });

        // Health check endpoint
        app.get('/health', async (req, res) => {
            try {
                const health = await this.check();
                
                const statusCode = health.status === 'healthy' ? 200 : 
                                  health.status === 'warning' ? 200 : 503;
                
                res.status(statusCode).json(health);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.metricsServer = app.listen(this.port, () => {
            console.log(`📊 Metrics server running on port ${this.port}`);
        });

        this.metricsServer.on('error', (error) => {
            console.error('Metrics server error:', error);
        });
    }

    getUptime() {
        const seconds = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            seconds,
            human: this.formatUptime(seconds)
        };
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0) parts.push(`${secs}s`);
        
        return parts.join(' ') || '0s';
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        if (this.metricsServer) {
            this.metricsServer.close();
        }
    }
}

module.exports = { HealthCheck };