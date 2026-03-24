// gateway/src/services/xml-parsers/base/BaseXmlParser.js

const { IXmlParser } = require('../../../contracts/IXmlParser');
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

class BaseXmlParser extends IXmlParser {
    constructor(config = {}) {
        super();
        this.vendorName = config.vendorName || 'Unknown';
        this.version = config.version || '1.0.0';
        this.arrayTags = config.arrayTags || [];
        this.attributeNamePrefix = config.attributeNamePrefix || '@_';
        this.xmlParser = null;
        
        this.initXmlParser();
    }

    initXmlParser() {
        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: this.attributeNamePrefix,
            parseAttributeValue: true,
            trimValues: true,
            parseTagValue: true,
            isArray: (name) => this.shouldBeArray(name),
            numberParseOptions: {
                hex: true,
                leadingZeros: false
            }
        });
    }

    shouldBeArray(tagName) {
        return this.arrayTags.includes(tagName);
    }

        async parse(filePath, options = {}) {
        try {
            const content = await this.readFile(filePath);
            const parsedXml = this.parseXml(content);
            
            if (!this.canParse(parsedXml, content)) {
                throw new Error(`Parser ${this.vendorName} cannot parse this file`);
            }
            
            const extractedData = await this.extractData(parsedXml, content, options);
            
            // Log the extracted data for debugging
            console.log(`🔍 ${this.vendorName} extractedData before transform:`, {
                hasMeasurements: !!extractedData.measurements,
                measurements: extractedData.measurements,
                hasDeviceInfo: !!extractedData.deviceInfo,
                deviceInfo: extractedData.deviceInfo,
                patientId: extractedData.patientId,
                vendor: extractedData.vendor
            });
            
            // Ensure extractedData has required structures
            if (!extractedData.patientInfo) {
                extractedData.patientInfo = {};
            }
            
            if (!extractedData.deviceInfo) {
                extractedData.deviceInfo = {};
            }
            
            if (!extractedData.measurements) {
                extractedData.measurements = {};
            }
            
            // Calculate file hash if not already present
            if (!extractedData.metadata?.fileHash) {
                const fileHash = await this.calculateHash(content);
                if (!extractedData.metadata) extractedData.metadata = {};
                extractedData.metadata.fileHash = fileHash;
            }
            
            // Return the extracted data directly - let the ConfigurableXmlParser handle transformation
            // This is the key fix - don't transform here, return the raw extracted data
            return extractedData;
            
        } catch (error) {
            console.error(`Error in ${this.vendorName} parser:`, error.message);
            throw error;
        }
    }

    /**
     * Extract interpretation - to be overridden by vendor-specific parsers
     * @param {Object} root - The parsed XML root
     * @returns {string|null} Formatted interpretation text
     */
    extractInterpretation(root) {
        // Default implementation - to be overridden by subclasses
        return null;
    }

    /**
     * Helper to format interpretation sections
     * @param {Array} sections - Array of section objects
     * @returns {string} Formatted interpretation
     */
    formatInterpretation(sections) {
        const parts = [];
        
        for (const section of sections) {
            if (section.title && section.content) {
                parts.push(`${section.title}: ${section.content}`);
            } else if (section.title && section.items && section.items.length > 0) {
                parts.push(`${section.title}:`);
                section.items.forEach((item, idx) => {
                    parts.push(`  ${idx + 1}. ${item}`);
                });
            }
        }
        
        return parts.length > 0 ? parts.join('\n') : null;
    }

    /**
     * Format interpretation for display in HTML
     * @param {string} interpretationText - The stored interpretation text
     * @returns {string} HTML formatted interpretation
     */
    formatInterpretationForDisplay(interpretationText) {
        if (!interpretationText) return '<p class="text-muted">No interpretation available</p>';
        
        let html = interpretationText
            .replace(/\n/g, '<br>')
            .replace(/SUMMARY:/g, '<strong>SUMMARY:</strong>')
            .replace(/DETAILS:/g, '<strong>DETAILS:</strong>')
            .replace(/FINDINGS:/g, '<strong>FINDINGS:</strong>')
            .replace(/CONCLUSION:/g, '<strong>CONCLUSION:</strong>')
            .replace(/IMPRESSION:/g, '<strong>IMPRESSION:</strong>')
            .replace(/RECOMMENDATIONS:/g, '<strong>RECOMMENDATIONS:</strong>')
            .replace(/COMMENTS:/g, '<strong>COMMENTS:</strong>');
        
        return `<div class="ecg-interpretation">${html}</div>`;
    }

    transformToDbFormat(extractedData, filePath, content) {
        // Log the incoming data structure for debugging
        console.log('🔄 transformToDbFormat received:', {
            hasMeasurements: !!extractedData.measurements,
            measurements: extractedData.measurements,
            hasDeviceInfo: !!extractedData.deviceInfo,
            deviceInfo: extractedData.deviceInfo,
            vendor: extractedData.vendor,
            patientId: extractedData.patientId
        });
        
        const result = {
            patientId: extractedData.patientId || null,
            deviceId: extractedData.deviceInfo?.deviceId || null,
            deviceModel: extractedData.deviceInfo?.deviceModel || extractedData.vendor,
            vendor: extractedData.vendor,
            recordingTime: extractedData.recordingTime,
            heartRate: extractedData.measurements?.heartRate || extractedData.heartRate || null,
            prInterval: extractedData.measurements?.prInterval || extractedData.prInterval || null,
            qrsDuration: extractedData.measurements?.qrsDuration || extractedData.qrsDuration || null,
            qtInterval: extractedData.measurements?.qtInterval || extractedData.qtInterval || null,
            waveformData: extractedData.waveform ? JSON.stringify(extractedData.waveform) : null,
            filePath: filePath,
            fileHash: extractedData.metadata?.fileHash || null,
            status: 'processed',
            patientInfo: extractedData.patientInfo,
            interpretation: extractedData.interpretation,
            metadata: {
                parser: this.vendorName,
                parserVersion: this.version,
                rawMeasurements: extractedData.measurements,
                rawDeviceInfo: extractedData.deviceInfo,
                rawPatientInfo: extractedData.patientInfo
            }
        };
        
        console.log('✅ transformToDbFormat result:', {
            patientId: result.patientId,
            vendor: result.vendor,
            deviceModel: result.deviceModel,
            heartRate: result.heartRate,
            prInterval: result.prInterval,
            qrsDuration: result.qrsDuration,
            qtInterval: result.qtInterval,
            recordingTime: result.recordingTime,
            hasWaveform: !!result.waveformData,
            hasInterpretation: !!result.interpretation
        });
        
        return result;
    }

    async readFile(filePath) {
        const fs = require('fs').promises;
        return await fs.readFile(filePath, 'utf-8');
    }

    parseXml(content) {
        if (!this.xmlParser) {
            throw new Error('XML parser not initialized');
        }
        return this.xmlParser.parse(content);
    }

    async extractData(parsedXml, rawContent, options) {
        throw new Error('extractData must be implemented by subclass');
    }

    canParse(parsedXml, rawContent) {
        throw new Error('canParse must be implemented by subclass');
    }

    getVendorName() {
        return this.vendorName;
    }

    getVersion() {
        return this.version;
    }

    validate(data) {
        const errors = [];
        
        if (!data.patientId) {
            errors.push('Patient ID is recommended but not required');
        }
        
        if (!data.recordingTime) {
            errors.push('Recording time is recommended but will use current time');
            // Set default recording time
            data.recordingTime = new Date().toISOString();
        }
        
        return {
            isValid: true, // Don't fail validation for missing optional fields
            errors
        };
    }

    getValueByPath(obj, path) {
        if (!obj || !path) return null;
        
        const parts = path.split('.');
        let current = obj;
        
        for (const part of parts) {
            if (current === null || current === undefined) return null;
            
            const arrayMatch = part.match(/(\w+)\[(\d+)\]/);
            if (arrayMatch) {
                const [, arrayName, index] = arrayMatch;
                if (!current[arrayName] || !Array.isArray(current[arrayName])) return null;
                current = current[arrayName][parseInt(index)];
            } else {
                current = current[part];
            }
        }
        
        return current;
    }

    parseIntSafe(value) {
        if (value === undefined || value === null) return null;
        const parsed = parseInt(value);
        return isNaN(parsed) ? null : parsed;
    }

    parseFloatSafe(value) {
        if (value === undefined || value === null) return null;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    }

    formatDateFromObject(dateObj) {
        if (!dateObj) return null;
        
        const year = dateObj.Year || dateObj.year;
        const month = dateObj.Month || dateObj.month;
        const day = dateObj.Day || dateObj.day;
        
        if (year && month && day) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        
        return null;
    }

    formatDateTimeFromObject(datetimeObj) {
        if (!datetimeObj) return null;
        
        const year = datetimeObj.Year || datetimeObj.year;
        const month = datetimeObj.Month || datetimeObj.month;
        const day = datetimeObj.Day || datetimeObj.day;
        const hour = datetimeObj.Hour || datetimeObj.hour || 0;
        const minute = datetimeObj.Minute || datetimeObj.minute || 0;
        const second = datetimeObj.Second || datetimeObj.second || 0;
        
        if (year && month && day) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
        }
        
        return null;
    }

    async calculateHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
}

module.exports = { BaseXmlParser };