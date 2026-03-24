// gateway/src/services/xml-parsers/vendors/PhilipsParser.js

const { BaseXmlParser } = require('../base/BaseXmlParser');

class PhilipsParser extends BaseXmlParser {
    constructor() {
        super({
            vendorName: 'Philips_IntelliSpace',
            version: '1.0.0',
            arrayTags: ['Lead', 'Complex']
        });
    }

    canParse(parsedXml, rawContent) {
        const root = parsedXml.ECG || parsedXml;
        return root['@_xmlns'] === 'http://www.philips.com/ecg' ||
               parsedXml.ECG !== undefined;
    }

    async extractData(parsedXml, rawContent, options) {
        const root = parsedXml.ECG || parsedXml;
        
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
        console.log('📊 PhilipsParser extracted measurements:', measurements);
        console.log('📊 PhilipsParser extracted deviceInfo:', deviceInfo);
        console.log('📊 PhilipsParser extracted waveform:', waveformData ? 'Yes' : 'No');
        console.log('📊 PhilipsParser extracted interpretation:', interpretation ? 'Yes' : 'No');
        
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
        const demographics = root.Demographics || root.Patient || {};
        
        return {
            medicalRecordNumber: demographics.MRN || demographics.PatientID,
            firstName: demographics.FirstName,
            lastName: demographics.LastName,
            dateOfBirth: demographics.BirthDate,
            gender: demographics.Gender
        };
    }

    extractDeviceInfo(root) {
        const device = root.Device || {};
        
        return {
            deviceId: device.SerialNumber,
            deviceModel: device.Model,
            manufacturer: 'Philips',
            softwareVer: device.SoftwareVersion
        };
    }

    extractMeasurements(root) {
        const analysis = root.Analysis || {};
        const intervals = analysis.Intervals || {};
        
        const result = {
            heartRate: this.parseIntSafe(analysis.HeartRate),
            prInterval: this.parseIntSafe(intervals.PR),
            qrsDuration: this.parseIntSafe(intervals.QRS),
            qtInterval: this.parseIntSafe(intervals.QT),
            qtcInterval: this.parseIntSafe(intervals.QTc),
            rrInterval: this.parseIntSafe(intervals.RR),
            pAxis: this.parseIntSafe(analysis.PAxis),
            qrsAxis: this.parseIntSafe(analysis.QRSAxis),
            tAxis: this.parseIntSafe(analysis.TAxis)
        };
        
        console.log('📈 PhilipsParser measurements extracted:', result);
        return result;
    }

    extractWaveformData(root) {
        let waveformData = null;
        
        // Try to get waveform from Waveforms section
        const waveforms = this.getValueByPath(root, 'Waveforms.Lead');
        if (waveforms && Array.isArray(waveforms)) {
            waveformData = {
                LeadConfig: 'Standard 12-Lead',
                SampleRate: 500,
                Gain: 10,
                Lead: waveforms.map(lead => ({
                    LeadID: lead.LeadID,
                    Data: lead.Data
                }))
            };
            console.log('🌊 Using full waveform data with', waveforms.length, 'leads');
        }
        
        // Try to get single waveform
        if (!waveformData) {
            const singleWaveform = this.getValueByPath(root, 'Waveform');
            if (singleWaveform) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: [
                        {
                            LeadID: 'II',
                            Data: singleWaveform
                        }
                    ]
                };
                console.log('🌊 Using single waveform data');
            }
        }
        
        if (!waveformData) {
            console.log('⚠️ No waveform data found in Philips file');
        }
        
        return waveformData;
    }

    extractRecordingTime(root) {
        let recordingTime = null;
        
        // Try from Recording
        if (root.Recording?.DateTime) {
            recordingTime = root.Recording.DateTime;
        }
        
        // Try from Study
        if (!recordingTime && root.Study?.StudyDateTime) {
            recordingTime = root.Study.StudyDateTime;
        }
        
        // Try from Header
        if (!recordingTime && root.Header?.CreationDateTime) {
            recordingTime = root.Header.CreationDateTime;
        }
        
        // Try from Acquisition
        if (!recordingTime && root.AcquisitionDateTime) {
            recordingTime = root.AcquisitionDateTime;
        }
        
        if (!recordingTime) {
            recordingTime = new Date().toISOString();
            console.log('⚠️ No recording time found, using current time');
        }
        
        console.log('⏰ PhilipsParser recordingTime:', recordingTime);
        return recordingTime;
    }

    extractInterpretation(root) {
        // Try to get interpretation from various possible locations
        let interpretation = root.Interpretation || root.ClinicalReport;
        
        if (!interpretation) return null;
        
        const sections = [];
        
        // Extract Text/Summary
        if (interpretation.Text) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Text
            });
        } else if (interpretation.Summary) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Summary
            });
        } else if (interpretation.Statement) {
            sections.push({
                title: 'SUMMARY',
                content: interpretation.Statement
            });
        }
        
        // Extract Findings
        if (interpretation.Findings) {
            const findings = [];
            
            if (Array.isArray(interpretation.Findings.Finding)) {
                interpretation.Findings.Finding.forEach(finding => {
                    const findingText = typeof finding === 'string' ? finding : finding['#text'] || finding;
                    if (findingText) findings.push(findingText);
                });
            } else if (interpretation.Findings.Finding) {
                const finding = interpretation.Findings.Finding;
                const findingText = typeof finding === 'string' ? finding : finding['#text'] || finding;
                if (findingText) findings.push(findingText);
            }
            
            if (findings.length > 0) {
                sections.push({
                    title: 'FINDINGS',
                    items: findings
                });
            }
        }
        
        // Extract Details
        if (interpretation.Details) {
            sections.push({
                title: 'DETAILS',
                content: interpretation.Details
            });
        }
        
        // Extract Clinical Impression
        if (interpretation.ClinicalImpression) {
            sections.push({
                title: 'CLINICAL IMPRESSION',
                content: interpretation.ClinicalImpression
            });
        }
        
        // Extract Recommendation
        if (interpretation.Recommendation) {
            sections.push({
                title: 'RECOMMENDATION',
                content: interpretation.Recommendation
            });
        } else if (interpretation.Recommendations) {
            sections.push({
                title: 'RECOMMENDATIONS',
                content: interpretation.Recommendations
            });
        }
        
        const formattedInterpretation = this.formatInterpretation(sections);
        if (formattedInterpretation) {
            console.log('📋 PhilipsParser interpretation extracted');
        }
        
        return formattedInterpretation;
    }
}

module.exports = { PhilipsParser };