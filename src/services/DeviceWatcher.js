// gateway/src/services/DeviceWatcher.js (updated with DI)

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');
const crypto = require('crypto');

class DeviceWatcher extends EventEmitter {
    constructor({ dropFolder, db, encryption, models, telemetryEnabled = false, xmlParser }) {
        super();
        if (!dropFolder) {
            throw new Error('Drop folder path is required');
        }

        // Add memory monitoring
        this.maxConcurrentFiles = parseInt(process.env.MAX_CONCURRENT_FILES) || 5;
        this.processingFiles = new Set();

        this.dropFolder = dropFolder;
        this.db = db;
        this.encryption = encryption;
        this.models = models;
        this.telemetryEnabled = telemetryEnabled;
        this.xmlParser = xmlParser; // Injected via DI
        // Set models on parser for patient lookup
        if (this.xmlParser && typeof this.xmlParser.setModels === 'function') {
            this.xmlParser.setModels(this.models);
            console.log('✅ Models set on XML parser for patient lookup');
        }
        this.watcher = null;
        this.isRunning = false;

        this.stats = {
            filesProcessed: 0,
            errors: 0,
            duplicates: 0,
            lastFile: null,
            deidentifiedSynced: 0,
            vendorStats: {},
            memoryUsage: []
        };

        // Monitor memory periodically
        this.memoryMonitor = setInterval(() => {
            const used = process.memoryUsage();
            this.stats.memoryUsage.push({
                timestamp: new Date().toISOString(),
                heapUsed: used.heapUsed,
                heapTotal: used.heapTotal,
                rss: used.rss
            });

            // Keep only last 100 entries
            if (this.stats.memoryUsage.length > 100) {
                this.stats.memoryUsage.shift();
            }
        }, 60000); // Every minute
    }

    async start() {
        if (this.isRunning) return;

        try {
            await fs.mkdir(this.dropFolder, { recursive: true });

            this.watcher = chokidar.watch(this.dropFolder, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                },
                ignored: /(^|[\/\\])\..|.*\.tmp$/
            });

            this.watcher
                .on('add', (filePath) => this.processFile(filePath))
                .on('error', (error) => this.handleError(error));

            this.isRunning = true;
            console.log(`👀 Device watcher started watching: ${this.dropFolder}`);
            console.log('Supported vendors:', this.xmlParser.getSupportedVendors());
            this.emit('started');
        } catch (error) {
            console.error('Failed to start device watcher:', error);
            throw error;
        }
    }

    async processFile(filePath) {
        const extension = path.extname(filePath).toLowerCase();

        try {
            console.log(`📄 Processing file: ${filePath}`);

            let record;
            if (extension === '.xml') {
                record = await this.processXmlFile(filePath);
            } else if (extension === '.pdf') {
                record = await this.processPdfFile(filePath);
            } else {
                console.log(`⚠️ Ignoring unsupported file: ${filePath}`);
                return;
            }

            // Store FULL PHI locally (encrypted)
            const localId = await this.models.ecgRecord.saveEcgRecord(record);

            // Update vendor stats
            if (record.vendor) {
                this.stats.vendorStats[record.vendor] = (this.stats.vendorStats[record.vendor] || 0) + 1;
            }

            // OPTIONAL: Send de-identified data to cloud
            if (this.telemetryEnabled && record.patientId) {
                const deidentifiedData = this.createDeidentifiedData(record, localId);
                await this.db.queueDeidentifiedSync(deidentifiedData);
                this.stats.deidentifiedSynced++;
            }

            this.stats.filesProcessed++;
            this.stats.lastFile = filePath;

            console.log(`✅ File processed: ${filePath} (ID: ${localId}, Vendor: ${record.vendor || 'PDF'})`);
            this.emit('fileProcessed', { filePath, localId, vendor: record.vendor });

        } catch (error) {
            this.stats.errors++;
            console.error(`❌ Error processing ${filePath}:`, error.message);
            await this.moveToQuarantine(filePath, error.message);
            this.emit('error', error);
        }
    }

    // In DeviceWatcher.js, update processXmlFile

    async processXmlFile(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');

        // Use configurable parser to extract data
        const extractedData = await this.xmlParser.parse(filePath);

        console.log('📊 Extracted data from parser:', {
            hasPatientId: !!extractedData.patientId,
            hasPatientInfo: !!extractedData.patientInfo,
            hasMeasurements: !!extractedData.measurements,
            hasDeviceInfo: !!extractedData.deviceInfo,
            hasVendor: !!extractedData.vendor,
            patientId: extractedData.patientId,
            vendor: extractedData.vendor,
            heartRate: extractedData.heartRate,
            recordingTime: extractedData.recordingTime,
            measurements: extractedData.measurements,
            deviceInfo: extractedData.deviceInfo
        });

        // Validate required fields
        if (!extractedData.patientId) {
            console.error('No patientId in extracted data');
            throw new Error('Missing required patient information');
        }

        // Prepare waveform data
        const rawWaveformData = extractedData.waveform;

        console.log('📊 Raw waveform data from parser:', {
            type: typeof rawWaveformData,
            isArray: Array.isArray(rawWaveformData),
            hasLead: rawWaveformData?.Lead ? true : false,
            leadCount: rawWaveformData?.Lead?.length,
            hasWaveform: rawWaveformData?.Waveform ? true : false
        });

        // Ensure recording time is a string
        let recordingTime = extractedData.recordingTime;
        if (recordingTime && typeof recordingTime === 'object') {
            // If it's still an object, convert to ISO string
            if (recordingTime.Year && recordingTime.Month && recordingTime.Day) {
                const year = recordingTime.Year;
                const month = String(recordingTime.Month).padStart(2, '0');
                const day = String(recordingTime.Day).padStart(2, '0');
                const hour = recordingTime.Hour ? String(recordingTime.Hour).padStart(2, '0') : '00';
                const minute = recordingTime.Minute ? String(recordingTime.Minute).padStart(2, '0') : '00';
                const second = recordingTime.Second ? String(recordingTime.Second).padStart(2, '0') : '00';
                recordingTime = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            } else {
                recordingTime = new Date().toISOString();
            }
        }

        // Create ECG record for database
        const ecgData = {
            patientId: extractedData.patientId,
            deviceId: extractedData.deviceInfo?.deviceId || extractedData.vendor,
            deviceModel: extractedData.deviceInfo?.deviceModel ||
                extractedData.deviceInfo?.softwareVer ||
                extractedData.vendor,
            vendor: extractedData.vendor,
            recordingTime: recordingTime,
            heartRate: extractedData.heartRate || extractedData.measurements?.heartRate,
            prInterval: extractedData.prInterval || extractedData.measurements?.prInterval,
            qrsDuration: extractedData.qrsDuration || extractedData.measurements?.qrsDuration,
            qtInterval: extractedData.qtInterval || extractedData.measurements?.qtInterval,
            interpretation: extractedData.interpretation,
            waveformData: rawWaveformData, // Store the encrypted string
            filePath: filePath,
            fileHash: extractedData.metadata?.fileHash,
            status: 'processed'
        };

        console.log('📝 ECG data prepared for save:', {
            patientId: ecgData.patientId,
            vendor: ecgData.vendor,
            deviceModel: ecgData.deviceModel,
            heartRate: ecgData.heartRate,
            prInterval: ecgData.prInterval,
            qrsDuration: ecgData.qrsDuration,
            qtInterval: ecgData.qtInterval,
            recordingTime: ecgData.recordingTime,
            hasWaveform: !!ecgData.waveformData,
            hasInterpretation: !!ecgData.interpretation,
            fileHash: ecgData.fileHash
        });

        // Save to database
        const localId = await this.models.ecgRecord.saveEcgRecord(ecgData);
        console.log(`✅ ECG record saved with ID: ${localId}`);

        return { ...ecgData, id: localId };
    }

    async processFile(filePath) {
        // Check concurrent file limit
        if (this.processingFiles.size >= this.maxConcurrentFiles) {
            console.log(`⚠️ Max concurrent files (${this.maxConcurrentFiles}) reached, queueing ${filePath}`);
            // Emit event to queue the file
            this.emit('fileQueued', filePath);
            return;
        }

        const extension = path.extname(filePath).toLowerCase();

        try {
            this.processingFiles.add(filePath);
            console.log(`📄 Processing file: ${filePath}`);

            // Force garbage collection before processing large file
            if (global.gc) {
                global.gc();
            }

            let record;
            if (extension === '.xml') {
                record = await this.processXmlFile(filePath);
            } else if (extension === '.pdf') {
                record = await this.processPdfFile(filePath);
            } else {
                console.log(`⚠️ Ignoring unsupported file: ${filePath}`);
                return;
            }

            // ... rest of processing logic

        } catch (error) {
            this.stats.errors++;
            console.error(`❌ Error processing ${filePath}:`, error.message);
            await this.moveToQuarantine(filePath, error.message);
            this.emit('error', error);
        } finally {
            this.processingFiles.delete(filePath);

            // Force garbage collection after processing
            if (global.gc) {
                global.gc();
            }
        }
    }

    async calculateHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    async moveToQuarantine(filePath, error) {
        const quarantineDir = path.join(path.dirname(filePath), 'quarantine');
        await fs.mkdir(quarantineDir, { recursive: true });

        const fileName = path.basename(filePath);
        const errorFileName = `${Date.now()}_${error.replace(/[^a-z0-9]/gi, '_')}_${fileName}`;
        const destPath = path.join(quarantineDir, errorFileName);

        await fs.rename(filePath, destPath);
        console.log(`📁 File moved to quarantine: ${destPath}`);
    }

    handleError(error) {
        console.error('Device watcher error:', error);
        this.emit('error', error);
    }

    async stop() {
        if (this.memoryMonitor) {
            clearInterval(this.memoryMonitor);
        }

        if (this.watcher) {
            await this.watcher.close();
            this.isRunning = false;
            console.log('🛑 Device watcher stopped');
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            dropFolder: this.dropFolder,
            telemetryEnabled: this.telemetryEnabled,
            supportedVendors: this.xmlParser.getSupportedVendors(),
            stats: this.stats
        };
    }
}

module.exports = { DeviceWatcher };