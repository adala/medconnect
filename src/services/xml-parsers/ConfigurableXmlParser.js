// gateway/src/services/xml-parsers/ConfigurableXmlParser.js

const { BaseXmlParser } = require('./base/BaseXmlParser');
const fs = require('fs').promises;

class ConfigurableXmlParser {
    constructor({ xmlParserFactory, vendorDetectionStrategy }) {
        if (!xmlParserFactory) {
            throw new Error('xmlParserFactory is required');
        }
        if (!vendorDetectionStrategy) {
            throw new Error('vendorDetectionStrategy is required');
        }

        this.factory = xmlParserFactory;
        this.detectionStrategy = vendorDetectionStrategy;
        this.defaultParser = null;
        this.models = null;
    }

    /**
     * Set models for patient lookup
     */
    setModels(models) {
        this.models = models;
    }

    /**
     * Parse XML file and return data ready for database
     */
    async parse(filePath, options = {}) {
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Try to detect parser
        let parser = null;
        
        if (options.detectFromContent !== false) {
            parser = await this.detectFromContent(content);
        }
        
        if (!parser) {
            const tempParser = this.factory.createParser('CardioSoft');
            const parsedXml = tempParser.parseXml(content);
            parser = this.factory.detectParser(parsedXml, content);
        }
        
        if (!parser && this.defaultParser) {
            console.warn(`⚠️ No parser detected for ${filePath}, using default parser`);
            parser = this.defaultParser;
        }
        
        if (!parser) {
            throw new Error(`No suitable parser found for file: ${filePath}`);
        }
        
        // Parse with detected parser - this now returns the raw extracted data
        const parsedData = await parser.parse(filePath, options);
        
        // Debug logging
        console.log('📦 Parsed data from vendor parser:', {
            hasPatientId: !!parsedData.patientId,
            patientId: parsedData.patientId,
            hasMeasurements: !!parsedData.measurements,
            measurements: parsedData.measurements,
            hasDeviceInfo: !!parsedData.deviceInfo,
            deviceInfo: parsedData.deviceInfo,
            vendor: parsedData.vendor,
            hasInterpretation: !!parsedData.interpretation,
            recordingTime: parsedData.recordingTime
        });
        
        // Ensure parsedData has the expected structure
        if (!parsedData.patientInfo) {
            parsedData.patientInfo = {};
        }
        
        if (!parsedData.measurements) {
            console.warn('⚠️ Measurements missing in parsed data, creating empty object');
            parsedData.measurements = {};
        }
        
        if (!parsedData.deviceInfo) {
            console.warn('⚠️ DeviceInfo missing in parsed data, creating empty object');
            parsedData.deviceInfo = {};
        }
        
        // Handle recording time if it's an object
        let recordingTime = parsedData.recordingTime;
        if (recordingTime && typeof recordingTime === 'object' && !(recordingTime instanceof Date)) {
            // Convert date object to ISO string
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
            parsedData.recordingTime = recordingTime;
        }
        
        // If we have models and patientId is a string (MRN), lookup or create patient
        if (this.models && parsedData.patientId && typeof parsedData.patientId === 'string') {
            try {
                const mrn = parsedData.patientId;
                const patient = await this.findOrCreatePatient(parsedData.patientInfo, mrn);
                parsedData.patientId = patient.id;
                console.log(`✅ Patient mapped: MRN ${mrn} -> ID ${patient.id}`);
            } catch (error) {
                console.error('Error finding/creating patient:', error.message);
                throw new Error(`Failed to process patient: ${error.message}`);
            }
        } else if (!parsedData.patientId) {
            throw new Error('No patient identifier found in the ECG file');
        }
        
        // Create the final result with all fields properly set
        const result = {
            patientId: parsedData.patientId,
            vendor: parsedData.vendor,
            patientInfo: parsedData.patientInfo,
            deviceInfo: parsedData.deviceInfo,
            measurements: parsedData.measurements,
            waveform: parsedData.waveform,
            recordingTime: parsedData.recordingTime,
            interpretation: parsedData.interpretation,
            // Also include individual fields for direct access
            heartRate: parsedData.measurements?.heartRate || null,
            prInterval: parsedData.measurements?.prInterval || null,
            qrsDuration: parsedData.measurements?.qrsDuration || null,
            qtInterval: parsedData.measurements?.qtInterval || null,
            metadata: parsedData.metadata || {}
        };
        
        console.log('✅ ConfigurableXmlParser final result:', {
            patientId: result.patientId,
            vendor: result.vendor,
            heartRate: result.heartRate,
            prInterval: result.prInterval,
            qrsDuration: result.qrsDuration,
            qtInterval: result.qtInterval,
            hasWaveform: !!result.waveform,
            hasInterpretation: !!result.interpretation,
            recordingTime: result.recordingTime
        });
        
        return result;
    }

    
    /**
     * Find or create patient based on MRN
     */
    async findOrCreatePatient(patientInfo, mrn) {
        if (!this.models || !this.models.patient) {
            throw new Error('Patient model not available');
        }

        if (!mrn) {
            throw new Error('Medical Record Number is required');
        }

        // Ensure patientInfo has default values
        const firstName = patientInfo?.firstName || patientInfo?.first_name || 'Unknown';
        const lastName = patientInfo?.lastName || patientInfo?.last_name || 'Patient';
        const dateOfBirth = patientInfo?.dateOfBirth || patientInfo?.dob || '1900-01-01';
        const gender = patientInfo?.gender || 'Unknown';

        console.log(`🔍 Looking up patient with MRN: ${mrn}`);

        try {
            // Try to find existing patient
            const existingPatient = await this.models.patient.findByMRN(mrn);

            if (existingPatient) {
                console.log(`✅ Found existing patient: ${existingPatient.id} (${existingPatient.first_name} ${existingPatient.last_name})`);

                // Update patient info if provided and different
                const updates = {};
                if (firstName && firstName !== 'Unknown' && existingPatient.first_name !== firstName) {
                    updates.first_name = firstName;
                }
                if (lastName && lastName !== 'Patient' && existingPatient.last_name !== lastName) {
                    updates.last_name = lastName;
                }
                if (dateOfBirth && dateOfBirth !== '1900-01-01' && existingPatient.date_of_birth !== dateOfBirth) {
                    updates.date_of_birth = dateOfBirth;
                }
                if (gender && gender !== 'Unknown' && existingPatient.gender !== gender) {
                    updates.gender = gender;
                }

                if (Object.keys(updates).length > 0) {
                    console.log(`📝 Updating patient info:`, updates);
                    await this.models.patient.update(existingPatient.id, updates);
                }

                return existingPatient;
            }

            // Create new patient
            console.log(`🆕 Creating new patient for MRN: ${mrn}`);
            const newPatient = await this.models.patient.create({
                medicalRecordNumber: mrn,
                firstName: firstName,
                lastName: lastName,
                dateOfBirth: dateOfBirth,
                gender: gender,
                tenantId: process.env.TENANT_ID,
                localOnly: true
            });

            console.log(`✅ Created new patient with ID: ${newPatient.id}`);
            return newPatient;

        } catch (error) {
            console.error('Error in findOrCreatePatient:', error);
            throw error;
        }
    }

    async detectFromContent(content) {
        const allParsers = this.factory.getAllParsers();

        for (const parser of allParsers) {
            const patterns = this.getVendorPatterns(parser.getVendorName());
            for (const pattern of patterns) {
                if (pattern.test(content.substring(0, 10000))) {
                    return parser;
                }
            }
        }

        return null;
    }

    getVendorPatterns(vendorName) {
        const patterns = {
            'CardioSoft': [/CardiologyXML/i, /CardioSoft/i],
            'Mindray': [/ECGReport/i, /Mindray/i],
            'GE_MUSE': [/MuseXML/i, /GE Healthcare/i],
            'Philips_IntelliSpace': [/xmlns="http:\/\/www\.philips\.com\/ecg"/i, /IntelliSpace/i]
        };

        return patterns[vendorName] || [];
    }

    setDefaultParser(parserName) {
        try {
            this.defaultParser = this.factory.createParser(parserName);
            console.log(`✅ Default parser set to: ${parserName}`);
        } catch (error) {
            console.error(`❌ Failed to create default parser ${parserName}:`, error.message);
        }
    }

    getSupportedVendors() {
        try {
            const parsers = this.factory.getAllParsers();
            return parsers.map(parser => ({
                name: parser.getVendorName(),
                version: parser.getVersion()
            }));
        } catch (error) {
            console.error('Error getting supported vendors:', error.message);
            return [];
        }
    }

    registerParser(name, parserClass) {
        if (this.factory) {
            this.factory.registerParser(name, parserClass);
        }
    }
}

module.exports = { ConfigurableXmlParser };