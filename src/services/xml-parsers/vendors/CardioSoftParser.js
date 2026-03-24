// gateway/src/services/xml-parsers/vendors/CardioSoftParser.js

const { BaseXmlParser } = require('../base/BaseXmlParser');

class CardioSoftParser extends BaseXmlParser {
    constructor() {
        super({
            vendorName: 'CardioSoft',
            version: '1.0.0',
            arrayTags: ['Finding', 'Lead', 'Median', 'TrendEntry']
        });
    }

    canParse(parsedXml, rawContent) {
        return parsedXml.CardiologyXML !== undefined;
    }

    async extractData(parsedXml, rawContent, options) {
        const root = parsedXml.CardiologyXML;
        
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
        console.log('📊 CardioSoftParser extracted measurements:', measurements);
        console.log('📊 CardioSoftParser extracted deviceInfo:', deviceInfo);
        console.log('📊 CardioSoftParser extracted waveform:', waveformData ? 'Yes' : 'No');
        console.log('📊 CardioSoftParser extracted interpretation:', interpretation ? 'Yes' : 'No');
        
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
        const patientInfo = root.PatientInfo || {};
        const name = patientInfo.Name || {};
        
        return {
            medicalRecordNumber: patientInfo.PID || patientInfo.MRN || patientInfo.PatientID,
            firstName: name.GivenName || patientInfo.FirstName,
            lastName: name.FamilyName || patientInfo.LastName,
            dateOfBirth: this.formatDateFromObject(patientInfo.BirthDateTime),
            gender: patientInfo.Gender,
            age: patientInfo.Age
        };
    }

    extractDeviceInfo(root) {
        const deviceInfo = root.ClinicalInfo?.DeviceInfo || {};
        
        return {
            deviceId: deviceInfo.ID,
            deviceModel: deviceInfo.Desc,
            manufacturer: 'CardioSoft',
            softwareVer: deviceInfo.SoftwareVer,
            analysisVer: deviceInfo.AnalysisVer
        };
    }

    extractMeasurements(root) {
        // Try to get measurements from RestingECG section first
        const restingMeasurements = root.RestingECG?.Measurements || {};
        const exerciseMeasurements = root.ExerciseMeasurements || {};
        const restingStats = exerciseMeasurements.RestingStats || {};
        
        // CardioSoft stores measurements in RestingECG.Measurements
        const measurements = {
            // Resting ECG measurements (most important)
            heartRate: this.parseIntSafe(restingMeasurements.HeartRate) || 
                       this.parseIntSafe(exerciseMeasurements.PeakExHR) ||
                       this.parseIntSafe(restingStats.RestHR),
            prInterval: this.parseIntSafe(restingMeasurements.PRInterval),
            qrsDuration: this.parseIntSafe(restingMeasurements.QRSDuration),
            qtInterval: this.parseIntSafe(restingMeasurements.QTInterval),
            qtcInterval: this.parseIntSafe(restingMeasurements.QTCInterval),
            
            // Exercise measurements (if available)
            maxHeartRate: this.parseIntSafe(exerciseMeasurements.MaxHeartRate),
            maxWorkload: this.parseIntSafe(exerciseMeasurements.MaxWorkload),
            exerciseTime: this.parseIntSafe(exerciseMeasurements.ExercisePhaseTime),
            
            // Axis measurements
            pAxis: this.parseIntSafe(restingMeasurements.PAxis),
            qrsAxis: this.parseIntSafe(restingMeasurements.QRSAxis),
            tAxis: this.parseIntSafe(restingMeasurements.TAxis)
        };
        
        console.log('📈 CardioSoftParser measurements extracted:', measurements);
        return measurements;
    }

    extractWaveformData(root) {
        let waveformData = null;
        
        // Try to get median beat waveform (most representative)
        if (root.MedianData?.Median && root.MedianData.Median.length > 0) {
            const medianBeat = root.MedianData.Median[0];
            if (medianBeat.WaveformData) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: [
                        {
                            LeadID: 'II',
                            Data: medianBeat.WaveformData
                        }
                    ]
                };
                console.log('🌊 Using median beat waveform data');
            }
        }
        
        // Try to get full waveform data
        if (!waveformData) {
            const leadWaveform = this.getValueByPath(root, 'WaveformData.Lead');
            if (leadWaveform && Array.isArray(leadWaveform)) {
                waveformData = {
                    LeadConfig: 'Standard 12-Lead',
                    SampleRate: 500,
                    Gain: 10,
                    Lead: leadWaveform.map(lead => ({
                        LeadID: lead.LeadID,
                        Data: lead.Data
                    }))
                };
                console.log('🌊 Using full waveform data with', leadWaveform.length, 'leads');
            }
        }
        
        // Fallback to any waveform data
        if (!waveformData) {
            const anyWaveform = this.getValueByPath(root, 'WaveformData') ||
                                this.getValueByPath(root, 'WaveFormData');
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
            console.log('⚠️ No waveform data found in CardioSoft file');
        }
        
        return waveformData;
    }

    extractRecordingTime(root) {
        let recordingTime = null;
        
        // Try to get from ObservationDateTime
        if (root.ObservationDateTime) {
            recordingTime = this.formatDateTimeFromObject(root.ObservationDateTime);
        }
        
        // Try from StudyInfo
        if (!recordingTime && root.StudyInfo?.StudyDateTime) {
            recordingTime = this.formatDateTimeFromObject(root.StudyInfo.StudyDateTime);
        }
        
        // Try from Recording
        if (!recordingTime) {
            recordingTime = this.getValueByPath(root, 'Recording.RecordingTime') ||
                           this.getValueByPath(root, 'RecordingTime');
        }
        
        if (!recordingTime) {
            recordingTime = new Date().toISOString();
            console.log('⚠️ No recording time found, using current time');
        }
        
        console.log('⏰ CardioSoftParser recordingTime:', recordingTime);
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
                    const findingText = typeof finding === 'string' ? finding : finding['#text'] || finding;
                    if (findingText) findings.push(findingText);
                });
            } else if (interpretation.Details.Finding) {
                const finding = interpretation.Details.Finding;
                const findingText = typeof finding === 'string' ? finding : finding['#text'] || finding;
                if (findingText) findings.push(findingText);
            }
            
            if (findings.length > 0) {
                sections.push({
                    title: 'DETAILS',
                    items: findings
                });
            }
        }
        
        // Extract Conclusion
        if (interpretation.Conclusion) {
            sections.push({
                title: 'CONCLUSION',
                content: interpretation.Conclusion
            });
        }
        
        // Extract Recommendations
        if (interpretation.Recommendations) {
            sections.push({
                title: 'RECOMMENDATIONS',
                content: interpretation.Recommendations
            });
        }
        
        // Extract Comments
        if (interpretation.Comments) {
            sections.push({
                title: 'COMMENTS',
                content: interpretation.Comments
            });
        }
        
        const formattedInterpretation = this.formatInterpretation(sections);
        if (formattedInterpretation) {
            console.log('📋 CardioSoftParser interpretation extracted');
        }
        
        return formattedInterpretation;
    }
}

module.exports = { CardioSoftParser };