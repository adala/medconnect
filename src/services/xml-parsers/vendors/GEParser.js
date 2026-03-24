// gateway/src/services/xml-parsers/vendors/GEParser.js

const { BaseXmlParser } = require('../base/BaseXmlParser');

class GEParser extends BaseXmlParser {
    constructor() {
        super({
            vendorName: 'GE_MUSE',
            version: '1.0.0',
            arrayTags: ['Lead', 'Beat', 'Measurement']
        });
    }

    canParse(parsedXml, rawContent) {
        return parsedXml.MuseXML !== undefined || 
               (rawContent && rawContent.includes('xmlns="http://www.ge.com/ecg"'));
    }

    async extractData(parsedXml, rawContent, options) {
        const root = parsedXml.MuseXML || parsedXml;
        
        // Extract patient info
        const patientInfo = this.extractPatientInfo(root);
        const patientId = patientInfo.medicalRecordNumber;
        
        // Extract device info
        const deviceInfo = this.extractDeviceInfo(root);
        
        // Extract measurements
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
        console.log('📊 GEParser extracted measurements:', measurements);
        console.log('📊 GEParser extracted deviceInfo:', deviceInfo);
        console.log('📊 GEParser extracted waveform:', waveformData ? 'Yes' : 'No');
        console.log('📊 GEParser extracted interpretation:', interpretation ? 'Yes' : 'No');
        
        // Return data with proper structure (aligned with Mindray)
        return {
            patientId: patientId,
            vendor: this.vendorName,
            patientInfo: patientInfo,
            deviceInfo: deviceInfo,
            measurements: measurements,
            waveform: waveformData,
            recordingTime: recordingTime,
            interpretation: interpretation,
            // Include individual measurement fields for direct access
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
        const demographics = root.PatientDemographics || root.Patient || {};
        
        return {
            medicalRecordNumber: demographics.MRN || demographics.PatientID,
            firstName: demographics.FirstName,
            lastName: demographics.LastName,
            dateOfBirth: demographics.DOB || demographics.BirthDate,
            gender: demographics.Gender,
            age: demographics.Age
        };
    }

    extractDeviceInfo(root) {
        const acquisition = root.AcquisitionInfo || {};
        
        return {
            deviceId: acquisition.DeviceID,
            deviceModel: acquisition.DeviceModel,
            manufacturer: 'GE Healthcare',
            softwareVer: acquisition.SoftwareVersion,
            acquisitionSite: acquisition.Site
        };
    }

    extractMeasurements(root) {
        const measurements = root.Measurements || root.RestingECG || {};
        
        const result = {
            heartRate: this.parseIntSafe(measurements.VentricularRate || measurements.HeartRate),
            prInterval: this.parseIntSafe(measurements.PRInterval),
            qrsDuration: this.parseIntSafe(measurements.QRSDuration),
            qtInterval: this.parseIntSafe(measurements.QTInterval),
            qtcInterval: this.parseIntSafe(measurements.QTCInterval),
            pDuration: this.parseIntSafe(measurements.PDuration),
            qrsAxis: this.parseIntSafe(measurements.QRSAxis),
            tAxis: this.parseIntSafe(measurements.TAxis)
        };
        
        console.log('📈 GEParser measurements extracted:', result);
        return result;
    }

    extractWaveformData(root) {
        let waveformData = null;
        
        // Try to get rhythm strip
        const rhythmStrip = this.getValueByPath(root, 'WaveformData.RhythmStrip');
        if (rhythmStrip) {
            waveformData = {
                LeadConfig: 'Standard 12-Lead',
                SampleRate: 500,
                Gain: 10,
                Lead: [
                    {
                        LeadID: 'II',
                        Data: rhythmStrip
                    }
                ]
            };
            console.log('🌊 Using rhythm strip waveform data');
        }
        
        // Try to get ECG waveform data
        if (!waveformData) {
            const ecgWaveform = this.getValueByPath(root, 'ECGWaveform.Data');
            if (ecgWaveform) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: [
                        {
                            LeadID: 'II',
                            Data: ecgWaveform
                        }
                    ]
                };
                console.log('🌊 Using ECG waveform data');
            }
        }
        
        // Try to get full lead data
        if (!waveformData) {
            const leads = this.getValueByPath(root, 'WaveformData.Lead');
            if (leads && Array.isArray(leads)) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: leads.map(lead => ({
                        LeadID: lead.LeadID,
                        Data: lead.Data
                    }))
                };
                console.log('🌊 Using full lead waveform data with', leads.length, 'leads');
            }
        }
        
        // Fallback to any waveform
        if (!waveformData) {
            const anyWaveform = this.getValueByPath(root, 'Waveform');
            if (anyWaveform) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: [
                        {
                            LeadID: 'II',
                            Data: anyWaveform
                        }
                    ]
                };
                console.log('🌊 Using fallback waveform data');
            }
        }
        
        if (!waveformData) {
            console.log('⚠️ No waveform data found in GE file');
        }
        
        return waveformData;
    }

    extractRecordingTime(root) {
        let recordingTime = null;
        
        // Try from AcquisitionInfo
        if (root.AcquisitionInfo?.AcquisitionDateTime) {
            recordingTime = this.formatDateTimeFromObject(root.AcquisitionInfo.AcquisitionDateTime);
        }
        
        // Try from Recording
        if (!recordingTime) {
            recordingTime = this.getValueByPath(root, 'Recording.Time');
        }
        
        // Try from header
        if (!recordingTime && root.Header?.CreationDateTime) {
            recordingTime = this.formatDateTimeFromObject(root.Header.CreationDateTime);
        }
        
        if (!recordingTime) {
            recordingTime = new Date().toISOString();
            console.log('⚠️ No recording time found, using current time');
        }
        
        console.log('⏰ GEParser recordingTime:', recordingTime);
        return recordingTime;
    }

    extractInterpretation(root) {
        // Try to get interpretation from various possible locations
        let interpretation = root.Interpretation || root.Conclusion;
        
        if (!interpretation) return null;
        
        const sections = [];
        
        // Extract Statement/Summary
        if (interpretation.Statement) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Statement
            });
        } else if (interpretation.Text) {
            sections.push({
                title: 'CONCLUSION',
                content: interpretation.Text
            });
        } else if (interpretation.Summary) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Summary
            });
        }
        
        // Extract Findings
        if (interpretation.Finding) {
            const findings = [];
            
            if (Array.isArray(interpretation.Finding)) {
                interpretation.Finding.forEach(finding => {
                    const desc = finding.Description || finding['#text'] || finding;
                    if (desc && typeof desc === 'string') {
                        findings.push(desc);
                    }
                });
            } else if (interpretation.Finding.Description) {
                findings.push(interpretation.Finding.Description);
            } else if (typeof interpretation.Finding === 'string') {
                findings.push(interpretation.Finding);
            }
            
            if (findings.length > 0) {
                sections.push({
                    title: 'FINDINGS',
                    items: findings
                });
            }
        }
        
        // Extract Impression
        if (interpretation.Impression) {
            sections.push({
                title: 'IMPRESSION',
                content: interpretation.Impression
            });
        }
        
        // Extract Recommendations
        if (interpretation.Recommendations) {
            sections.push({
                title: 'RECOMMENDATIONS',
                content: interpretation.Recommendations
            });
        }
        
        const formattedInterpretation = this.formatInterpretation(sections);
        if (formattedInterpretation) {
            console.log('📋 GEParser interpretation extracted');
        }
        
        return formattedInterpretation;
    }
}

module.exports = { GEParser };