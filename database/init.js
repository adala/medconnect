// gateway/src/database/init.js

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function initializeDatabase(dbPath = './data/offin.db') {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Enable foreign keys
    await db.exec('PRAGMA foreign_keys = ON');

    // Create tables
    await db.exec(`
        -- Patients table
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            medical_record_number TEXT,
            first_name TEXT,
            last_name TEXT,
            date_of_birth TEXT,
            gender TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            local_only BOOLEAN DEFAULT true,
            synced BOOLEAN DEFAULT false,
            created_at DATETIME,
            updated_at DATETIME,
            UNIQUE(medical_record_number)
        );

        -- ECG records table
        CREATE TABLE IF NOT EXISTS ecg_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            device_id TEXT,
            device_model TEXT,
            vendor TEXT,
            recording_time DATETIME,
            heart_rate INTEGER,
            pr_interval INTEGER,
            qrs_duration INTEGER,
            qt_interval INTEGER,
            waveform_data TEXT,
            interpretation TEXT,
            file_path TEXT,
            file_hash TEXT UNIQUE,
            status TEXT DEFAULT 'pending',
            synced BOOLEAN DEFAULT false,
            created_at DATETIME,
            updated_at DATETIME,
            FOREIGN KEY (patient_id) REFERENCES patients (id)
        );

        -- HL7 messages table
        CREATE TABLE IF NOT EXISTS hl7_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_type TEXT,
            message_control_id TEXT UNIQUE,
            patient_mrn TEXT,
            raw_message TEXT,
            parsed_data TEXT,
            status TEXT DEFAULT 'received',
            synced BOOLEAN DEFAULT false,
            cloud_id TEXT,
            synced_at DATETIME,
            created_at DATETIME
        );

        -- Sync queue table
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id INTEGER NOT NULL,
            record_type TEXT NOT NULL,
            operation TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            error TEXT,
            created_at DATETIME,
            updated_at DATETIME,
            processed_at DATETIME
        );

        -- Sync queue table
        CREATE TABLE IF NOT EXISTS deidentified_sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_record_id INTEGER NOT NULL,
            record_type TEXT NOT NULL,
            deidentified_data TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            last_attempt DATETIME,
            error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            synced_at DATETIME
        );

        -- System events log
        CREATE TABLE IF NOT EXISTS system_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT,
            severity TEXT,
            message TEXT,
            details TEXT,
            created_at DATETIME
        );

        -- Sync log
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            records_synced INTEGER,
            errors INTEGER,
            duration INTEGER,
            status TEXT,
            error_message TEXT,
            created_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS sync_errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id INTEGER,
            error TEXT,
            created_at DATETIME
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_ecg_patient ON ecg_records(patient_id);
        CREATE INDEX IF NOT EXISTS idx_ecg_synced ON ecg_records(synced);
        CREATE INDEX IF NOT EXISTS idx_ecg_hash ON ecg_records(file_hash);
        -- CREATE INDEX idx_ecg_records_vendor ON ecg_records(vendor);
        
        CREATE INDEX IF NOT EXISTS idx_patient_mrn ON patients(medical_record_number);
        CREATE INDEX IF NOT EXISTS idx_patient_synced ON patients(synced);
        
        CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
        CREATE INDEX IF NOT EXISTS idx_queue_type ON sync_queue(record_type);

        CREATE INDEX IF NOT EXISTS idx_deidentified_status ON deidentified_sync_queue(status);
        CREATE INDEX IF NOT EXISTS idx_deidentified_created ON deidentified_sync_queue(created_at);
        
        CREATE INDEX IF NOT EXISTS idx_hl7_mrn ON hl7_messages(patient_mrn);
        CREATE INDEX IF NOT EXISTS idx_hl7_synced ON hl7_messages(synced);
        
        CREATE INDEX IF NOT EXISTS idx_events_created ON system_events(created_at);
    `);

    console.log('✅ Database initialized');
    return db;
}

module.exports = { initializeDatabase };