// gateway/src/models/LocalEcgRecord.js

class LocalEcgRecord {
    constructor(db) {
        this.db = db;
    }

    async create(recordData) {
        const {
            patientId,
            deviceId,
            deviceModel,
            recordingTime,
            heartRate,
            prInterval,
            qrsDuration,
            qtInterval,
            waveformData,
            interpretation,
            filePath,
            fileHash,
            status = 'pending'
        } = recordData;

        const result = await this.db.run(
            `INSERT INTO ecg_records (
                patient_id, device_id, device_model, recording_time,
                heart_rate, pr_interval, qrs_duration, qt_interval,
                waveform_data, interpretation, file_path, file_hash, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                patientId,
                deviceId,
                deviceModel,
                recordingTime,
                heartRate,
                prInterval,
                qrsDuration,
                qtInterval,
                waveformData,
                interpretation,
                filePath,
                fileHash,
                status,
                new Date().toISOString(),
                new Date().toISOString()
            ]
        );

        return this.findById(result.lastID);
    }

    async findById(id) {
        return this.db.get(
            `SELECT r.*, p.medical_record_number, p.first_name, p.last_name
             FROM ecg_records r
             LEFT JOIN patients p ON r.patient_id = p.id
             WHERE r.id = ?`,
            id
        );
    }

    async findByPatient(patientId, limit = 50, offset = 0) {
        return this.db.all(
            `SELECT * FROM ecg_records 
             WHERE patient_id = ? 
             ORDER BY recording_time DESC 
             LIMIT ? OFFSET ?`,
            [patientId, limit, offset]
        );
    }

    async findByFileHash(fileHash) {
        return this.db.get(
            'SELECT * FROM ecg_records WHERE file_hash = ?',
            fileHash
        );
    }

    async getUnsynced(limit = 100) {
        return this.db.all(
            `SELECT r.*, p.medical_record_number, p.first_name, p.last_name
             FROM ecg_records r
             LEFT JOIN patients p ON r.patient_id = p.id
             WHERE r.synced = false OR r.synced IS NULL
             ORDER BY r.created_at ASC
             LIMIT ?`,
            limit
        );
    }

    async markAsSynced(ids) {
        if (!ids || ids.length === 0) return;

        const placeholders = ids.map(() => '?').join(',');
        await this.db.run(
            `UPDATE ecg_records SET synced = true, synced_at = ? 
             WHERE id IN (${placeholders})`,
            [new Date().toISOString(), ...ids]
        );
    }

    async getStats() {
        const total = await this.db.get('SELECT COUNT(*) as count FROM ecg_records');
        const synced = await this.db.get(
            'SELECT COUNT(*) as count FROM ecg_records WHERE synced = true'
        );
        const pending = await this.db.get(
            'SELECT COUNT(*) as count FROM ecg_records WHERE synced = false OR synced IS NULL'
        );

        return {
            total: total.count,
            synced: synced.count,
            pending: pending.count
        };
    }

    async deleteOldRecords(daysOld = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = await this.db.run(
            'DELETE FROM ecg_records WHERE created_at < ? AND synced = true',
            cutoffDate.toISOString()
        );

        return result.changes;
    }

    async getRecent(limit = 20) {
        return this.db.all(
            `SELECT r.*, p.first_name, p.last_name
             FROM ecg_records r
             LEFT JOIN patients p ON r.patient_id = p.id
             ORDER BY r.created_at DESC
             LIMIT ?`,
            limit
        );
    }

    async queueDeidentifiedSync(deidentifiedData) {
        const result = await this.db.run(
            `INSERT INTO deidentified_sync_queue 
             (local_record_id, record_type, deidentified_data, status)
             VALUES (?, ?, ?, ?)`,
            [deidentifiedData.localId, 'ecg', JSON.stringify(deidentifiedData), 'pending']
        );

        return result.lastID;
    }

    async getPendingDeidentifiedSync(limit = 100) {
        return this.db.all(
            `SELECT * FROM deidentified_sync_queue 
             WHERE status = 'pending' 
             ORDER BY created_at ASC 
             LIMIT ?`,
            limit
        );
    }

    async markDeidentifiedSynced(ids) {
        const placeholders = ids.map(() => '?').join(',');
        await this.db.run(
            `UPDATE deidentified_sync_queue 
             SET status = 'synced', synced_at = ? 
             WHERE id IN (${placeholders})`,
            [new Date().toISOString(), ...ids]
        );
    }

    async markDeidentifiedFailed(id, error) {
        await this.db.run(
            `UPDATE deidentified_sync_queue 
             SET status = 'failed', 
                 attempts = attempts + 1,
                 last_attempt = ?,
                 error = ?
             WHERE id = ?`,
            [new Date().toISOString(), error, id]
        );
    }

    // In LocalEcgRecord.js, add a method to get waveform data

    async getWaveformData(id) {
        try {
            const record = await this.findById(id);
            if (!record || !record.waveform_data) return null;

            // If it's a string, try to parse it
            if (typeof record.waveform_data === 'string') {
                try {
                    return JSON.parse(record.waveform_data);
                } catch (e) {
                    console.error('Failed to parse waveform data:', e);
                    return null;
                }
            }

            // If it's already an object, return it
            if (typeof record.waveform_data === 'object') {
                return record.waveform_data;
            }

            return null;
        } catch (error) {
            console.error('Error getting waveform data:', error);
            return null;
        }
    }

    /**
     * Process waveform data to ensure it's stored correctly
     * @param {any} waveformData - The waveform data from parser
     * @returns {string|null} Properly formatted JSON string or null
     */
    processWaveformData(waveformData) {
        if (!waveformData) return null;

        try {
            // If it's already a string
            if (typeof waveformData === 'string') {
                // Check if it's the problematic "[object Object]" string
                if (waveformData === '[object Object]') {
                    console.error('❌ Found corrupted "[object Object]" data, skipping');
                    return null;
                }

                // Try to validate if it's valid JSON
                try {
                    JSON.parse(waveformData);
                    console.log('✅ Waveform data is already valid JSON string');
                    return waveformData;
                } catch (e) {
                    // Not valid JSON, so it might be a different format
                    console.log('⚠️ Waveform string is not valid JSON, will wrap in object');
                    // Wrap it in a standard format
                    return JSON.stringify({ data: waveformData });
                }
            }

            // If it's an array (simple waveform data)
            if (Array.isArray(waveformData)) {
                console.log('📊 Processing array waveform data, length:', waveformData.length);
                return JSON.stringify({ II: waveformData });
            }

            // If it's an object with Lead array (Mindray/Philips format)
            if (waveformData.Lead && Array.isArray(waveformData.Lead)) {
                console.log('📊 Processing Lead array format, leads:', waveformData.Lead.length);
                // Process each lead to ensure Data is properly formatted
                const processedLeads = waveformData.Lead.map(lead => ({
                    LeadID: lead.LeadID,
                    Data: typeof lead.Data === 'string' ? lead.Data : JSON.stringify(lead.Data)
                }));
                return JSON.stringify({ ...waveformData, Lead: processedLeads });
            }

            // If it's an object with Waveform array (Philips format)
            if (waveformData.Waveform && Array.isArray(waveformData.Waveform)) {
                console.log('📊 Processing Waveform array format');
                const processedWaveforms = waveformData.Waveform.map(wave => ({
                    LeadID: wave.LeadID,
                    Data: typeof wave.Data === 'string' ? wave.Data : JSON.stringify(wave.Data)
                }));
                return JSON.stringify({ ...waveformData, Waveform: processedWaveforms });
            }

            // If it's a regular object, stringify it
            if (typeof waveformData === 'object') {
                console.log('📊 Processing object waveform data, keys:', Object.keys(waveformData));
                return JSON.stringify(waveformData);
            }

            // Fallback - convert to string and wrap
            console.log('⚠️ Unknown waveform format, wrapping in object');
            return JSON.stringify({ data: String(waveformData) });

        } catch (error) {
            console.error('Error processing waveform data:', error);
            return null;
        }
    }

    // In LocalEcgRecord.js, update saveEcgRecord
    async saveEcgRecord(recordData) {
        const {
            patientId,
            deviceId,
            deviceModel,
            vendor,
            recordingTime,
            heartRate,
            prInterval,
            qrsDuration,
            qtInterval,
            interpretation,
            waveformData,
            filePath,
            fileHash,
            status = 'processed'
        } = recordData;

        // Validate required fields
        if (!patientId) {
            throw new Error('patientId is required to save ECG record');
        }

        try {
            // Check for duplicate by file hash
            if (fileHash) {
                const existing = await this.findByFileHash(fileHash);
                if (existing) {
                    console.log(`Duplicate record found for hash: ${fileHash}, ID: ${existing.id}`);
                    return existing.id;
                }
            }

            const now = new Date().toISOString();
            const recordingTimeValue = recordingTime || now;

            // Process waveform data - this is the key fix
            const processedWaveformData = this.processWaveformData(waveformData);
            
            console.log('💾 Saving ECG record with processed waveform:', {
                originalType: typeof waveformData,
                processedType: typeof processedWaveformData,
                processedLength: processedWaveformData ? processedWaveformData.length : 0,
                isNull: processedWaveformData === null
            });
            
            const result = await this.db.run(
                `INSERT INTO ecg_records (
                patient_id, device_id, device_model, vendor, recording_time,
                heart_rate, pr_interval, qrs_duration, qt_interval,
                interpretation, waveform_data, file_path, file_hash, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    patientId,
                    deviceId || null,
                    deviceModel || null,
                    vendor || 'Unknown',
                    recordingTimeValue,
                    heartRate !== undefined && heartRate !== null ? heartRate : null,
                    prInterval !== undefined && prInterval !== null ? prInterval : null,
                    qrsDuration !== undefined && qrsDuration !== null ? qrsDuration : null,
                    qtInterval !== undefined && qtInterval !== null ? qtInterval : null,
                    interpretation || null,
                    processedWaveformData, // Store as string
                    filePath || null,
                    fileHash || null,
                    status,
                    now,
                    now
                ]
            );

            if (!result || !result.lastID) {
                throw new Error('Failed to insert ECG record - no ID returned');
            }

            return await this.findById(result.lastID);

        } catch (error) {
            console.error('Error saving ECG record:', error);
            throw new Error(`Failed to save ECG record: ${error.message}`);
        }
    }

    // Add method to find by file hash
    async findByFileHash(fileHash) {
        if (!fileHash) return null;

        try {
            const record = await this.db.get(
                'SELECT id FROM ecg_records WHERE file_hash = ?',
                fileHash
            );
            return record;
        } catch (error) {
            console.error('Error finding by file hash:', error);
            return null;
        }
    }

    // Add method to get recent records with vendor info
    async getRecent(limit = 20, offset = 0) {
        try {
            return await this.db.all(
                `SELECT r.*, p.first_name, p.last_name, p.medical_record_number
                 FROM ecg_records r
                 LEFT JOIN patients p ON r.patient_id = p.id
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );
        } catch (error) {
            console.error('Error getting recent ECG records:', error);
            return [];
        }
    }

    // Add method to get stats by vendor
    async getStatsByVendor() {
        try {
            return await this.db.all(
                `SELECT vendor, COUNT(*) as count, 
                        SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced_count,
                        AVG(heart_rate) as avg_heart_rate
                 FROM ecg_records 
                 WHERE vendor IS NOT NULL
                 GROUP BY vendor
                 ORDER BY count DESC`
            );
        } catch (error) {
            console.error('Error getting stats by vendor:', error);
            return [];
        }
    }

    // Update getStats to include vendor breakdown
    async getStats() {
        try {
            const total = await this.db.get('SELECT COUNT(*) as count FROM ecg_records');
            const synced = await this.db.get('SELECT COUNT(*) as count FROM ecg_records WHERE synced = 1');
            const pending = await this.db.get('SELECT COUNT(*) as count FROM ecg_records WHERE synced = 0 OR synced IS NULL');
            const byVendor = await this.getStatsByVendor();

            return {
                total: total?.count || 0,
                synced: synced?.count || 0,
                pending: pending?.count || 0,
                byVendor: byVendor
            };
        } catch (error) {
            console.error('Error getting ECG stats:', error);
            return { total: 0, synced: 0, pending: 0, byVendor: [] };
        }
    }

    // Add method to get records by patient
    async findByPatient(patientId, limit = 50, offset = 0) {
        try {
            return await this.db.all(
                `SELECT * FROM ecg_records 
                 WHERE patient_id = ? 
                 ORDER BY recording_time DESC 
                 LIMIT ? OFFSET ?`,
                [patientId, limit, offset]
            );
        } catch (error) {
            console.error('Error finding ECG by patient:', error);
            return [];
        }
    }

    // Add method to delete record
    async delete(id) {
        try {
            const result = await this.db.run('DELETE FROM ecg_records WHERE id = ?', id);
            return result.changes > 0;
        } catch (error) {
            console.error('Error deleting ECG record:', error);
            return false;
        }
    }
}

module.exports = { LocalEcgRecord };