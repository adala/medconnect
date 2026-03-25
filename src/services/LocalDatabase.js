// gateway/src/services/LocalDatabase.js

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

class LocalDatabase {
    constructor({ path, encryption }) {
        this.path = path;
        this.encryption = encryption;
        this.db = null;
    }

    async initialize() {
        this.db = await open({
            filename: this.path,
            driver: sqlite3.Database
        });

        await this.createTables();
        console.log('✅ Local database initialized');
    }

    async createTables() {
        // Patients table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                medical_record_number TEXT UNIQUE,
                first_name TEXT,
                last_name TEXT,
                date_of_birth TEXT,
                gender TEXT,
                local_only BOOLEAN DEFAULT true,
                synced BOOLEAN DEFAULT false,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ECG records table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS ecg_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER,
                device_id TEXT,
                device_model TEXT,
                recording_time DATETIME,
                heart_rate INTEGER,
                pr_interval INTEGER,
                qrs_duration INTEGER,
                qt_interval INTEGER,
                waveform_data TEXT,
                file_path TEXT,
                file_hash TEXT UNIQUE,
                status TEXT DEFAULT 'pending',
                synced BOOLEAN DEFAULT false,
                cloud_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients (id)
            )
        `);

        // Sync queue
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id INTEGER NOT NULL,
                record_type TEXT NOT NULL,
                operation TEXT NOT NULL,
                priority INTEGER DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME,
                error TEXT,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sync log
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                records_synced INTEGER,
                errors INTEGER,
                duration INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ecg_synced ON ecg_records(synced);
            CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
            CREATE INDEX IF NOT EXISTS idx_patient_mrn ON patients(medical_record_number);
        `);
    }

    async savePatient(patientData) {
        const { medicalRecordNumber, firstName, lastName, dateOfBirth, gender } = patientData;
        
        // Check if patient exists
        const existing = await this.db.get(
            'SELECT id FROM patients WHERE medical_record_number = ?',
            medicalRecordNumber
        );

        if (existing) {
            // Update
            await this.db.run(
                `UPDATE patients SET 
                 first_name = ?, last_name = ?, date_of_birth = ?, 
                 gender = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE medical_record_number = ?`,
                [firstName, lastName, dateOfBirth, gender, medicalRecordNumber]
            );
            return existing.id;
        } else {
            // Insert
            const result = await this.db.run(
                `INSERT INTO patients 
                 (tenant_id, medical_record_number, first_name, last_name, date_of_birth, gender)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [process.env.TENANT_ID, medicalRecordNumber, firstName, lastName, dateOfBirth, gender]
            );
            return result.lastID;
        }
    }

    async saveEcgRecord(recordData) {
        const {
            patientId, deviceId, deviceModel, recordingTime,
            heartRate, prInterval, qrsDuration, qtInterval,
            waveformData, filePath, fileHash, status
        } = recordData;

        // Check for duplicate
        const existing = await this.db.get(
            'SELECT id FROM ecg_records WHERE file_hash = ?',
            fileHash
        );

        if (existing) {
            return existing.id;
        }

        const result = await this.db.run(
            `INSERT INTO ecg_records 
             (patient_id, device_id, device_model, recording_time,
              heart_rate, pr_interval, qrs_duration, qt_interval,
              waveform_data, file_path, file_hash, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patientId, deviceId, deviceModel, recordingTime,
             heartRate, prInterval, qrsDuration, qtInterval,
             waveformData, filePath, fileHash, status]
        );

        return result.lastID;
    }

    async queueForSync(recordId, recordType = 'ecg', operation = 'create') {
        await this.db.run(
            `INSERT INTO sync_queue (record_id, record_type, operation)
             VALUES (?, ?, ?)`,
            [recordId, recordType, operation]
        );
    }

    async getUnsyncedRecords(limit = 100) {
        return this.db.all(
            `SELECT q.*, 
                    e.*,
                    p.medical_record_number as patient_mrn,
                    p.first_name as patient_first_name,
                    p.last_name as patient_last_name
             FROM sync_queue q
             JOIN ecg_records e ON q.record_id = e.id
             JOIN patients p ON e.patient_id = p.id
             WHERE q.status = 'pending'
             ORDER BY q.priority DESC, q.created_at ASC
             LIMIT ?`,
            limit
        );
    }

    async markAsSynced(recordIds) {
        const placeholders = recordIds.map(() => '?').join(',');
        
        await this.db.run(
            `UPDATE sync_queue 
             SET status = 'completed', attempts = attempts + 1
             WHERE record_id IN (${placeholders})`,
            recordIds
        );

        await this.db.run(
            `UPDATE ecg_records 
             SET synced = true 
             WHERE id IN (${placeholders})`,
            recordIds
        );
    }

    async logSync(stats) {
        await this.db.run(
            `INSERT INTO sync_log (records_synced, errors, duration)
             VALUES (?, ?, ?)`,
            [stats.recordsSynced, stats.errors, stats.duration]
        );
    }

    async getStats() {
        const ecgCount = await this.db.get('SELECT COUNT(*) as count FROM ecg_records');
        const patientCount = await this.db.get('SELECT COUNT(*) as count FROM patients');
        const pendingSync = await this.db.get(
            'SELECT COUNT(*) as count FROM sync_queue WHERE status = "pending"'
        );
        const lastSync = await this.db.get(
            'SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 1'
        );

        return {
            ecgRecords: ecgCount.count,
            patients: patientCount.count,
            pendingSync: pendingSync.count,
            lastSync: lastSync
        };
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }
}

module.exports = { LocalDatabase };