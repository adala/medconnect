// gateway/src/services/DeidentifiedSyncService.js

const axios = require('axios');

class DeidentifiedSyncService {
    constructor({ tenantId, cloudUrl, apiKey, db, models, logger }) {
        this.tenantId = tenantId;
        this.cloudUrl = cloudUrl;
        this.apiKey = apiKey;
        this.db = db;
        this.models = models;
        this.logger = logger;
        this.syncTimer = null;
        this.isSyncing = false;
        this.telemetryEnabled = false;
        
        this.stats = {
            lastSync: null,
            lastSyncStatus: null,
            totalSynced: 0,
            errors: 0
        };
    }

    async start(interval = 3600000) { // Default 1 hour
        console.log('🔄 De-identified sync service started');
        
        // Check if telemetry is enabled from config
        this.telemetryEnabled = process.env.TELEMETRY_ENABLED === 'true';
        
        if (!this.telemetryEnabled) {
            console.log('ℹ️ Telemetry disabled - no de-identified data will be sent');
            return;
        }
        
        // Initial sync
        await this.sync();
        
        // Schedule regular sync
        this.syncTimer = setInterval(() => this.sync(), interval);
    }

    async sync() {
        if (!this.telemetryEnabled) return;
        
        if (this.isSyncing) {
            console.log('⚠️ Sync already in progress, skipping...');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            console.log('📤 Sending de-identified data for research...');

            // Check cloud connection
            const isConnected = await this.checkConnection();
            if (!isConnected) {
                console.log('⏸️ Cloud unavailable, sync deferred');
                return;
            }

            // Get pending de-identified data
            const pending = await this.models.ecgRecord.getPendingDeidentifiedSync(100);

            if (pending.length === 0) {
                console.log('✅ No pending de-identified data');
                return;
            }

            console.log(`📊 Sending ${pending.length} de-identified records`);

            // Prepare payload (already de-identified)
            const payload = pending.map(record => ({
                id: record.id,
                localRecordId: record.local_record_id,
                tenantId: this.tenantId,
                data: JSON.parse(record.deidentified_data),
                timestamp: record.created_at
            }));

            // Send to cloud research endpoint
            const response = await axios.post(
                `${this.cloudUrl}/api/research/deidentified`,
                { records: payload },
                {
                    headers: {
                        'X-Tenant-ID': this.tenantId,
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            if (response.data.success) {
                // Mark as synced
                const syncedIds = response.data.synced.map(r => r.id);
                await this.models.ecgRecord.markDeidentifiedSynced(syncedIds);

                this.stats.lastSync = new Date();
                this.stats.lastSyncStatus = 'success';
                this.stats.totalSynced += syncedIds.length;

                console.log(`✅ Synced ${syncedIds.length} de-identified records`);

                // Handle errors
                if (response.data.errors?.length) {
                    console.warn(`⚠️ ${response.data.errors.length} records failed`);
                    for (const error of response.data.errors) {
                        await this.models.ecgRecord.markDeidentifiedFailed(error.id, error.error);
                        this.stats.errors++;
                    }
                }
            }

        } catch (error) {
            this.stats.lastSyncStatus = 'error';
            this.stats.errors++;
            
            console.error('❌ De-identified sync failed:', error.message);
            
            if (error.response) {
                console.error('Server response:', error.response.data);
            }

        } finally {
            this.isSyncing = false;
        }
    }

    async checkConnection() {
        try {
            const response = await axios.get(`${this.cloudUrl}/health`, {
                timeout: 5000,
                headers: {
                    'X-Tenant-ID': this.tenantId,
                    'X-API-Key': this.apiKey
                }
            });
            
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    async stop() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }
    }

    getStatus() {
        return {
            ...this.stats,
            isSyncing: this.isSyncing,
            telemetryEnabled: this.telemetryEnabled
        };
    }
}

module.exports = { DeidentifiedSyncService };