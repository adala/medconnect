// gateway/src/services/xml-parsers/vendors/MindrayParser.js

const { BaseXmlParser } = require('../base/BaseXmlParser');

class MindrayParser extends BaseXmlParser {
    constructor() {
        super({
            vendorName: 'Mindray',
            version: '1.0.0',
            arrayTags: ['Lead', 'Waveform']
        });
    }

    canParse(parsedXml, rawContent) {
        return parsedXml.ECGReport !== undefined || parsedXml.EcgReport !== undefined;
    }

    async extractData(parsedXml, rawContent, options) {
        const root = parsedXml.ECGReport || parsedXml.EcgReport || parsedXml;

        // Extract patient info
        const patientInfo = this.extractPatientInfo(root);
        const patientId = patientInfo.patientId;

        // Extract device info
        const deviceInfo = this.extractDeviceInfo(root);

        // Extract measurements - store in a variable
        const measurements = this.extractMeasurements(root);

        // Extract waveform data
        const waveformData = this.extractWaveformData(root);

        // Extract recording time
        const recordingTime = this.extractRecordingTime(root);

        // Extract interpretation
        const interpretation = this.extractInterpretation(root);

        // Calculate hash for deduplication
        const fileHash = await this.calculateHash(rawContent);

        // Debug logging
        console.log('📊 MindrayParser extracted measurements:', measurements);
        console.log('📊 MindrayParser extracted deviceInfo:', deviceInfo);

        // Return data with proper structure - measurements should be at the top level
        return {
            patientId: patientId,
            vendor: this.vendorName,
            patientInfo: patientInfo,
            deviceInfo: deviceInfo,  // Make sure deviceInfo is included
            measurements: measurements,  // Make sure measurements is included
            waveform: waveformData,
            recordingTime: recordingTime,
            interpretation: interpretation,
            // Also include individual measurement fields for direct access
            heartRate: measurements?.heartRate || null,
            prInterval: measurements?.prInterval || null,
            qrsDuration: measurements?.qrsDuration || null,
            qtInterval: measurements?.qtInterval || null,
            metadata: {
                fileHash: fileHash,
                parserVersion: this.version,
                parseTimestamp: new Date().toISOString(),
                rawMeasurements: measurements,
                rawDeviceInfo: deviceInfo
            }
        };
    }

    extractPatientInfo(root) {
        const patientInfo = root.PatientInfo || {};

        return {
            medicalRecordNumber: patientInfo.MRN || patientInfo.PatientID,
            patientId: patientInfo.PatientID,
            firstName: patientInfo.FirstName,
            lastName: patientInfo.LastName,
            dateOfBirth: patientInfo.DateOfBirth,
            gender: patientInfo.Gender,
            age: patientInfo.Age
        };
    }

    extractDeviceInfo(root) {
        const deviceInfo = root.DeviceInfo || {};

        const result = {
            deviceId: deviceInfo.DeviceID || deviceInfo.DeviceId,
            deviceModel: deviceInfo.DeviceModel || deviceInfo.Model,
            manufacturer: deviceInfo.Manufacturer || 'Mindray',
            softwareVer: deviceInfo.SoftwareVersion || deviceInfo.Version
        };

        console.log('🔧 MindrayParser deviceInfo extracted:', result);
        return result;
    }

    extractMeasurements(root) {
        const measurements = root.Measurements || {};

        const result = {
            heartRate: this.parseIntSafe(measurements.HeartRate),
            prInterval: this.parseIntSafe(measurements.PRInterval),
            qrsDuration: this.parseIntSafe(measurements.QRSDuration),
            qtInterval: this.parseIntSafe(measurements.QTInterval),
            qtcInterval: this.parseIntSafe(measurements.QTCInterval),
            pAxis: this.parseIntSafe(measurements.PAxis),
            qrsAxis: this.parseIntSafe(measurements.QRSAxis),
            tAxis: this.parseIntSafe(measurements.TAxis),
            rrInterval: this.parseIntSafe(measurements.RRInterval)
        };

        console.log('📈 MindrayParser measurements extracted:', result);
        return result;
    }

    extractWaveformData(root) {
        const waveform = this.getValueByPath(root, 'WaveformData') ||
            this.getValueByPath(root, 'WaveFormData');

        if (waveform) {
            console.log('🌊 MindrayParser waveform extracted (length):',
                Array.isArray(waveform) ? waveform.length : 'object');
        } else {
            console.log('⚠️ No waveform data found in Mindray file');
        }

        return waveform;
    }

    extractRecordingTime(root) {
        const recordingTime = this.getValueByPath(root, 'Recording.RecordingTime') ||
            this.getValueByPath(root, 'RecordingTime') ||
            new Date().toISOString();

        console.log('⏰ MindrayParser recordingTime:', recordingTime);
        return recordingTime;
    }

    extractInterpretation(root) {
        const interpretation = root.Interpretation;
        if (!interpretation) return null;

        const sections = [];

        // Extract Summary
        if (interpretation.Summary) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Summary
            });
        }

        // Extract Details with Findings
        if (interpretation.Details) {
            const findings = [];

            if (Array.isArray(interpretation.Details.Finding)) {
                interpretation.Details.Finding.forEach(finding => {
                    if (finding && typeof finding === 'string') {
                        findings.push(finding);
                    } else if (finding && finding['#text']) {
                        findings.push(finding['#text']);
                    }
                });
            } else if (interpretation.Details.Finding) {
                const finding = interpretation.Details.Finding;
                const findingText = typeof finding === 'string' ? finding : finding['#text'] || finding;
                findings.push(findingText);
            }

            if (findings.length > 0) {
                sections.push({
                    title: 'FINDINGS',
                    items: findings
                });
            }
        }

        // Extract Diagnosis
        if (interpretation.Diagnosis) {
            sections.push({
                title: 'DIAGNOSIS',
                content: interpretation.Diagnosis
            });
        }

        // Extract Recommendation
        if (interpretation.Recommendation) {
            sections.push({
                title: 'RECOMMENDATION',
                content: interpretation.Recommendation
            });
        }

        const formattedInterpretation = this.formatInterpretation(sections);
        if (formattedInterpretation) {
            console.log('📋 MindrayParser interpretation extracted');
        }

        return formattedInterpretation;
    }

    extractRecordingTime(root) {
        // Try to get recording time from various locations
        let recordingTime = null;

        // Check for Recording.RecordingTime object
        if (root.Recording && root.Recording.RecordingTime) {
            const rt = root.Recording.RecordingTime;
            if (typeof rt === 'object') {
                const year = rt.Year;
                const month = String(rt.Month).padStart(2, '0');
                const day = String(rt.Day).padStart(2, '0');
                const hour = rt.Hour ? String(rt.Hour).padStart(2, '0') : '00';
                const minute = rt.Minute ? String(rt.Minute).padStart(2, '0') : '00';
                const second = rt.Second ? String(rt.Second).padStart(2, '0') : '00';
                recordingTime = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            } else {
                recordingTime = rt;
            }
        }

        // Check for direct RecordingTime
        if (!recordingTime && root.RecordingTime) {
            recordingTime = root.RecordingTime;
        }

        // Check for Header CreationDateTime
        if (!recordingTime && root.Header && root.Header.CreationDateTime) {
            const dt = root.Header.CreationDateTime;
            if (typeof dt === 'object') {
                const year = dt.Year;
                const month = String(dt.Month).padStart(2, '0');
                const day = String(dt.Day).padStart(2, '0');
                const hour = dt.Hour ? String(dt.Hour).padStart(2, '0') : '00';
                const minute = dt.Minute ? String(dt.Minute).padStart(2, '0') : '00';
                const second = dt.Second ? String(dt.Second).padStart(2, '0') : '00';
                recordingTime = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            } else {
                recordingTime = dt;
            }
        }

        // If still no recording time, use current time
        if (!recordingTime) {
            recordingTime = new Date().toISOString();
            console.log('⚠️ No recording time found, using current time');
        }

        console.log('⏰ MindrayParser recordingTime:', recordingTime);
        return recordingTime;
    }
}

module.exports = { MindrayParser };