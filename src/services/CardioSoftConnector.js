// gateway/src/services/CardioSoftConnector.js

const { EventEmitter } = require('events');
const crypto = require('crypto');

class CardioSoftConnector extends EventEmitter {
    constructor({ dbConfig, encryption, models, telemetryEnabled = false }) {
        super();
        
        this.dbConfig = dbConfig;
        this.encryption = encryption;
        this.models = models;
        this.telemetryEnabled = telemetryEnabled;
        this.isRunning = false;
        this.poller = null;
        this.lastChecked = null;
        this.connection = null;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        
        this.stats = {
            recordsProcessed: 0,
            errors: 0,
            duplicates: 0,
            lastRecord: null,
            deidentifiedSynced: 0,
            connectionErrors: 0
        };
    }

    async start(pollingInterval = 60000) {
        if (this.isRunning) return;
        
        try {
            // Attempt to connect to database
            const connected = await this.connectToDatabase();
            
            if (!connected) {
                console.warn('⚠️ Could not connect to CardioSoft database. Will retry later.');
                // Start poller but will check connection on each poll
            }
            
            // Set last checked time to 5 minutes ago to catch any recent records
            this.lastChecked = new Date(Date.now() - 5 * 60 * 1000);
            
            // Start polling
            this.poller = setInterval(async () => {
                await this.checkForNewRecords();
            }, pollingInterval);
            
            this.isRunning = true;
            console.log(`🔄 CardioSoft connector started (polling every ${pollingInterval / 1000}s)`);
            this.emit('started');
            
        } catch (error) {
            console.error('Failed to start CardioSoft connector:', error);
            // Don't throw - just log and continue without CardioSoft
            this.isRunning = false;
            this.emit('error', error);
        }
    }

    async connectToDatabase() {
        try {
            const { type, host, database, username, password, filePath, connectionTimeout = 30000 } = this.dbConfig;
            
            if (!host && type !== 'sqlite') {
                console.error('CardioSoft database host not configured');
                return false;
            }
            
            if (type === 'mssql') {
                // Dynamic import to avoid requiring mssql if not used
                const sql = require('mssql');
                
                const config = {
                    server: host,
                    database: database,
                    user: username,
                    password: password,
                    options: {
                        encrypt: true,
                        trustServerCertificate: true,
                        enableArithAbort: true,
                        connectTimeout: connectionTimeout,
                        requestTimeout: connectionTimeout
                    },
                    connectionTimeout: connectionTimeout,
                    requestTimeout: connectionTimeout
                };
                
                console.log(`🔌 Attempting to connect to CardioSoft SQL Server at ${host}:1433...`);
                
                this.connection = await sql.connect(config);
                console.log('✅ Connected to CardioSoft SQL Server database');
                this.connectionAttempts = 0;
                return true;
                
            } else if (type === 'sqlite') {
                const sqlite3 = require('sqlite3').verbose();
                const { open } = require('sqlite');
                
                if (!filePath) {
                    console.error('CardioSoft SQLite database file path not configured');
                    return false;
                }
                
                console.log(`🔌 Attempting to connect to CardioSoft SQLite database at ${filePath}...`);
                
                this.connection = await open({
                    filename: filePath,
                    driver: sqlite3.Database
                });
                
                console.log('✅ Connected to CardioSoft SQLite database');
                this.connectionAttempts = 0;
                return true;
            }
            
            console.error(`Unsupported CardioSoft database type: ${type}`);
            return false;
            
        } catch (error) {
            this.connectionAttempts++;
            this.stats.connectionErrors++;
            console.error(`Failed to connect to CardioSoft database (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}):`, error.message);
            
            if (this.connectionAttempts >= this.maxConnectionAttempts) {
                console.error('⚠️ Max connection attempts reached. CardioSoft integration will be disabled until restart.');
                this.emit('connectionFailed', error);
                return false;
            }
            
            return false;
        }
    }

    async checkForNewRecords() {
        // Skip if no connection
        if (!this.connection) {
            console.log('⏳ CardioSoft: No database connection, attempting to reconnect...');
            const connected = await this.connectToDatabase();
            if (!connected) return;
        }
        
        try {
            console.log('🔍 Checking CardioSoft for new ECG records...');
            
            // Test connection with a simple query
            try {
                await this.testConnection();
            } catch (connError) {
                console.error('CardioSoft connection lost, attempting to reconnect...');
                this.connection = null;
                const connected = await this.connectToDatabase();
                if (!connected) return;
            }
            
            // Query new records since last check
            const newRecords = await this.queryNewRecords();
            
            if (newRecords && newRecords.length > 0) {
                console.log(`📊 Found ${newRecords.length} new CardioSoft records`);
                
                for (const record of newRecords) {
                    await this.processCardioSoftRecord(record);
                }
                
                // Update last checked time
                if (newRecords.length > 0) {
                    const latestRecord = newRecords.reduce((latest, current) => {
                        const currentDate = new Date(current.ExamDateTime || current.recording_time);
                        const latestDate = new Date(latest.ExamDateTime || latest.recording_time);
                        return currentDate > latestDate ? current : latest;
                    });
                    this.lastChecked = new Date(latestRecord.ExamDateTime || latestRecord.recording_time);
                }
            } else {
                console.log('No new CardioSoft records found');
            }
            
        } catch (error) {
            console.error('Error checking CardioSoft records:', error.message);
            this.stats.errors++;
            this.emit('error', error);
            
            // If connection error, reset connection
            if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED') {
                this.connection = null;
            }
        }
    }

    async testConnection() {
        if (this.dbConfig.type === 'mssql') {
            const result = await this.connection.request().query('SELECT 1 as Test');
            return result.recordset[0].Test === 1;
        } else if (this.dbConfig.type === 'sqlite') {
            const result = await this.connection.get('SELECT 1 as Test');
            return result.Test === 1;
        }
        return false;
    }

    async queryNewRecords() {
        if (!this.connection) return [];
        
        const lastCheckedStr = this.lastChecked ? this.lastChecked.toISOString() : new Date(0).toISOString();
        
        try {
            if (this.dbConfig.type === 'mssql') {
                // Check if tables exist first
                const tableCheck = await this.connection.request().query(`
                    SELECT COUNT(*) as hasTable 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_NAME = 'Exams'
                `);
                
                if (tableCheck.recordset[0].hasTable === 0) {
                    console.log('CardioSoft Exams table not found - database may be empty or not initialized');
                    return [];
                }
                
                const query = `
                    SELECT TOP 50
                        e.ExamID,
                        e.ExamDateTime,
                        e.PatientID,
                        e.ExamStatus,
                        e.HeartRate,
                        e.PRInterval,
                        e.QRSDuration,
                        e.QTInterval,
                        e.InterpretationText,
                        e.WaveformData,
                        p.MRN as PatientMRN,
                        p.LastName,
                        p.FirstName,
                        p.DateOfBirth,
                        p.Gender,
                        d.DeviceID,
                        d.DeviceModel,
                        d.SoftwareVersion
                    FROM Exams e
                    LEFT JOIN Patients p ON e.PatientID = p.PatientID
                    LEFT JOIN Devices d ON e.DeviceID = d.DeviceID
                    WHERE e.ExamDateTime > @lastChecked
                    AND (e.ExamStatus = 'Completed' OR e.ExamStatus IS NULL)
                    ORDER BY e.ExamDateTime ASC
                `;
                
                const request = this.connection.request();
                request.input('lastChecked', lastCheckedStr);
                const result = await request.query(query);
                return result.recordset;
                
            } else if (this.dbConfig.type === 'sqlite') {
                // Check if tables exist
                const tableCheck = await this.connection.get(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='Exams'"
                );
                
                if (!tableCheck) {
                    console.log('CardioSoft Exams table not found - database may be empty or not initialized');
                    return [];
                }
                
                const query = `
                    SELECT 
                        e.ExamID,
                        e.ExamDateTime,
                        e.PatientID,
                        e.ExamStatus,
                        e.HeartRate,
                        e.PRInterval,
                        e.QRSDuration,
                        e.QTInterval,
                        e.InterpretationText,
                        e.WaveformData,
                        p.MRN as PatientMRN,
                        p.LastName,
                        p.FirstName,
                        p.DateOfBirth,
                        p.Gender,
                        d.DeviceID,
                        d.DeviceModel,
                        d.SoftwareVersion
                    FROM Exams e
                    LEFT JOIN Patients p ON e.PatientID = p.PatientID
                    LEFT JOIN Devices d ON e.DeviceID = d.DeviceID
                    WHERE e.ExamDateTime > ?
                    AND (e.ExamStatus = 'Completed' OR e.ExamStatus IS NULL)
                    ORDER BY e.ExamDateTime ASC
                    LIMIT 50
                `;
                
                return await this.connection.all(query, [lastCheckedStr]);
            }
            
            return [];
            
        } catch (error) {
            console.error('Error querying CardioSoft database:', error.message);
            // If table doesn't exist, return empty array
            if (error.message.includes('no such table') || error.message.includes('Invalid object name')) {
                console.log('CardioSoft tables not found. Database may not be initialized.');
                return [];
            }
            throw error;
        }
    }

    // ... rest of the methods (processCardioSoftRecord, transformCardioSoftData, etc.)

    async stop() {
        if (this.poller) {
            clearInterval(this.poller);
            this.poller = null;
        }
        
        if (this.connection) {
            try {
                if (this.dbConfig.type === 'mssql') {
                    await this.connection.close();
                } else if (this.dbConfig.type === 'sqlite') {
                    await this.connection.close();
                }
            } catch (error) {
                console.error('Error closing CardioSoft connection:', error);
            }
            this.connection = null;
        }
        
        this.isRunning = false;
        console.log('🛑 CardioSoft connector stopped');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            isConnected: !!this.connection,
            dbType: this.dbConfig?.type,
            dbHost: this.dbConfig?.host,
            lastChecked: this.lastChecked,
            connectionAttempts: this.connectionAttempts,
            stats: this.stats
        };
    }
}

module.exports = { CardioSoftConnector };