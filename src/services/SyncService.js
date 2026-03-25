// gateway/src/services/SyncService.js

const axios = require('axios');

class SyncService {
    constructor({ tenantId, cloudUrl, apiKey, db, encryption, models }) {
        this.tenantId = tenantId;
        this.cloudUrl = cloudUrl;
        this.apiKey = apiKey;
        this.db = db;
        this.encryption = encryption;
        this.models = models;
        this.syncTimer = null;
        this.isSyncing = false;
        this.isConnected = false;
        this.status = {
            lastSync: null,
            lastSyncStatus: null,
            totalSynced: 0,
            errors: 0,
            isConnected: false
        };
    }

    async start(interval) {
        console.log('🔄 Sync service started');
        
        // Check connection
        await this.checkConnection();
        
        // Initial sync
        await this.sync();
        
        // Schedule regular sync
        this.syncTimer = setInterval(() => this.sync(), interval);
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
            
            this.isConnected = response.status === 200;
            this.status.isConnected = this.isConnected;
            
            return this.isConnected;
        } catch (error) {
            this.isConnected = false;
            this.status.isConnected = false;
            console.log('⚠️ Cloud connection unavailable - operating offline');
            return false;
        }
    }

    async sync() {
        if (this.isSyncing) {
            console.log('⚠️ Sync already in progress, skipping...');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();
        let records = [];

        try {
            console.log('📤 Starting cloud sync...');

            // Check connection first
            const isConnected = await this.checkConnection();
            if (!isConnected) {
                console.log('⏸️ Cloud unavailable, sync deferred');
                this.status.lastSyncStatus = 'offline';
                return;
            }

            // Get unsynced ECG records
            records = await this.models.ecgRecord.getUnsynced(100);

            if (records.length === 0) {
                console.log('✅ Nothing to sync');
                this.status.lastSyncStatus = 'no-data';
                return;
            }

            console.log(`📊 Syncing ${records.length} ECG records`);

            // Prepare payload
            const payload = await Promise.all(records.map(async (record) => {
                // Get patient data if available
                let patient = null;
                if (record.patient_id) {
                    patient = await this.models.patient.findById(record.patient_id);
                }

                return {
                    localId: record.id,
                    tenantId: this.tenantId,
                    deviceId: record.device_id,
                    deviceModel: record.device_model,
                    recordingTime: record.recording_time,
                    heartRate: record.heart_rate,
                    prInterval: record.pr_interval,
                    qrsDuration: record.qrs_duration,
                    qtInterval: record.qt_interval,
                    waveformData: record.waveform_data, // Already encrypted
                    fileHash: record.file_hash,
                    patient: patient ? {
                        medicalRecordNumber: patient.medical_record_number,
                        firstName: this.encryption.encrypt(patient.first_name || ''),
                        lastName: this.encryption.encrypt(patient.last_name || ''),
                        dateOfBirth: patient.date_of_birth,
                        gender: patient.gender
                    } : null
                };
            }));

            // Send to cloud
            const response = await axios.post(
                `${this.cloudUrl}/api/sync/ecg`,
                { records: payload },
                {
                    headers: {
                        'X-Tenant-ID': this.tenantId,
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000 // 60 seconds
                }
            );

            if (response.data.success) {
                // Mark as synced
                const syncedIds = response.data.synced.map(r => r.localId);
                await this.models.ecgRecord.markAsSynced(syncedIds);

                // Log sync
                await this.db.run(
                    `INSERT INTO sync_log (records_synced, errors, duration, status, created_at)
                     VALUES (?, ?, ?, ?, ?)`,
                    [syncedIds.length, response.data.errors?.length || 0, Date.now() - startTime, 'success', new Date().toISOString()]
                );

                this.status.lastSync = new Date();
                this.status.lastSyncStatus = 'success';
                this.status.totalSynced += syncedIds.length;

                console.log(`✅ Synced ${syncedIds.length} records`);

                // Handle partial errors
                if (response.data.errors?.length) {
                    console.warn(`⚠️ ${response.data.errors.length} records failed:`, response.data.errors);
                    
                    // Log failed records
                    for (const error of response.data.errors) {
                        await this.db.run(
                            `INSERT INTO sync_errors (record_id, error, created_at)
                             VALUES (?, ?, ?)`,
                            [error.localId, error.error, new Date().toISOString()]
                        );
                    }
                }
            }

        } catch (error) {
            this.status.lastSyncStatus = 'error';
            this.status.errors++;
            
            console.error('❌ Sync failed:', error.message);
            
            if (error.response) {
                console.error('Server response:', error.response.data);
            }

            // Log failed sync attempt
            await this.db.run(
                `INSERT INTO sync_log (records_synced, errors, duration, status, error_message, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [0, records?.length || 0, Date.now() - startTime, 'failed', error.message, new Date().toISOString()]
            );

        } finally {
            this.isSyncing = false;
        }
    }

    async syncUsers() {
        try {
            console.log('👤 Syncing users from cloud...');
            
            const response = await axios.get(
                `${this.cloudUrl}/api/sync/users`,
                {
                    headers: {
                        'X-Tenant-ID': this.tenantId,
                        'X-API-Key': this.apiKey
                    },
                    timeout: 30000
                }
            );

            if (response.data.success && response.data.users) {
                for (const userData of response.data.users) {
                    await this.models.user.syncFromCloud(userData);
                }
                console.log(`✅ Synced ${response.data.users.length} users`);
            }
        } catch (error) {
            console.error('❌ User sync failed:', error.message);
        }
    }

    async syncConfig() {
        try {
            console.log('⚙️ Syncing configuration from cloud...');
            
            const response = await axios.get(
                `${this.cloudUrl}/api/sync/config`,
                {
                    headers: {
                        'X-Tenant-ID': this.tenantId,
                        'X-API-Key': this.apiKey
                    },
                    timeout: 30000
                }
            );

            if (response.data.success) {
                // Update local config
                // This would update gateway settings
                console.log('✅ Configuration synced');
                return response.data.config;
            }
        } catch (error) {
            console.error('❌ Config sync failed:', error.message);
        }
    }

    async stop() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }
    }

    getStatus() {
        return {
            ...this.status,
            isSyncing: this.isSyncing,
            isConnected: this.isConnected
        };
    }
}

module.exports = { SyncService };