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
        
        // Extract waveform data - FIXED: Extract all leads properly
        const waveformData = this.extractWaveformData(root);
        
        // Extract recording time
        const recordingTime = this.extractRecordingTime(root);
        
        // Extract interpretation
        const interpretation = this.extractInterpretation(root);
        
        // Calculate hash for deduplication
        const fileHash = await this.calculateHash(rawContent);
        
        // Debug logging
        console.log('📊 GEParser extracted waveform:', {
            type: typeof waveformData,
            isArray: Array.isArray(waveformData),
            hasLeadArray: waveformData?.Lead ? true : false,
            leadCount: waveformData?.Lead?.length,
            leadIds: waveformData?.Lead?.map(l => l.LeadID)
        });
        
        return {
            patientId: patientId,
            vendor: this.vendorName,
            patientInfo: patientInfo,
            deviceInfo: deviceInfo,
            measurements: measurements,
            waveform: waveformData,
            recordingTime: recordingTime,
            interpretation: interpretation,
            heartRate: measurements?.heartRate || null,
            prInterval: measurements?.prInterval || null,
            qrsDuration: measurements?.qrsDuration || null,
            qtInterval: measurements?.qtInterval || null,
            metadata: {
                fileHash: fileHash,
                parserVersion: this.version,
                parseTimestamp: new Date().toISOString()
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
        
        return {
            heartRate: this.parseIntSafe(measurements.VentricularRate || measurements.HeartRate),
            prInterval: this.parseIntSafe(measurements.PRInterval),
            qrsDuration: this.parseIntSafe(measurements.QRSDuration),
            qtInterval: this.parseIntSafe(measurements.QTInterval),
            qtcInterval: this.parseIntSafe(measurements.QTCInterval),
            pDuration: this.parseIntSafe(measurements.PDuration),
            qrsAxis: this.parseIntSafe(measurements.QRSAxis),
            tAxis: this.parseIntSafe(measurements.TAxis)
        };
    }

    extractWaveformData(root) {
        // Try multiple possible locations for waveform data
        let waveformData = null;
        
        // Method 1: Check for WaveformData with RhythmStrip
        const rhythmStrip = this.getValueByPath(root, 'WaveformData.RhythmStrip');
        if (rhythmStrip && typeof rhythmStrip === 'string') {
            waveformData = this.parseWaveformString(rhythmStrip);
        }
        
        // Method 2: Check for ECGWaveform.Data
        if (!waveformData) {
            const ecgWaveform = this.getValueByPath(root, 'ECGWaveform.Data');
            if (ecgWaveform && typeof ecgWaveform === 'string') {
                waveformData = this.parseWaveformString(ecgWaveform);
            }
        }
        
        // Method 3: Check for Lead array in WaveformData
        const leadArray = this.getValueByPath(root, 'WaveformData.Lead');
        if (leadArray && Array.isArray(leadArray)) {
            waveformData = this.processLeadArray(leadArray);
            console.log('✅ Found GE Lead array with', leadArray.length, 'leads');
        }
        
        // Method 4: Check for direct Waveform tag
        if (!waveformData) {
            const directWaveform = this.getValueByPath(root, 'Waveform');
            if (directWaveform && typeof directWaveform === 'object') {
                if (directWaveform.Lead && Array.isArray(directWaveform.Lead)) {
                    waveformData = this.processLeadArray(directWaveform.Lead);
                } else if (typeof directWaveform === 'string') {
                    waveformData = this.parseWaveformString(directWaveform);
                }
            }
        }
        
        // If still no waveform, try to find any data in the structure
        if (!waveformData) {
            waveformData = this.searchForWaveformData(root);
        }
        
        // If we have waveform data but it's just a single lead, try to expand
        if (waveformData && !waveformData.Lead && !waveformData.I && !waveformData.II) {
            waveformData = this.expandToStandardLeads(waveformData);
        }
        
        return waveformData;
    }

    processLeadArray(leadArray) {
        if (!leadArray || !Array.isArray(leadArray)) return null;
        
        const processedLeads = [];
        
        for (const lead of leadArray) {
            let leadData = null;
            let leadId = null;
            
            // Extract lead ID
            if (lead.LeadID) {
                leadId = lead.LeadID;
            } else if (lead.Lead) {
                leadId = lead.Lead;
            } else if (lead.Name) {
                leadId = lead.Name;
            }
            
            // Extract lead data
            if (lead.Data) {
                if (typeof lead.Data === 'string') {
                    leadData = this.parseWaveformString(lead.Data);
                } else if (Array.isArray(lead.Data)) {
                    leadData = lead.Data;
                }
            } else if (lead.Waveform) {
                if (typeof lead.Waveform === 'string') {
                    leadData = this.parseWaveformString(lead.Waveform);
                } else if (Array.isArray(lead.Waveform)) {
                    leadData = lead.Waveform;
                }
            } else if (lead.Values) {
                if (typeof lead.Values === 'string') {
                    leadData = this.parseWaveformString(lead.Values);
                } else if (Array.isArray(lead.Values)) {
                    leadData = lead.Values;
                }
            }
            
            if (leadId && leadData && leadData.length > 0) {
                processedLeads.push({
                    LeadID: leadId,
                    Data: leadData
                });
            }
        }
        
        if (processedLeads.length > 0) {
            return { Lead: processedLeads };
        }
        
        return null;
    }

    parseWaveformString(waveformStr) {
        if (!waveformStr || typeof waveformStr !== 'string') return null;
        
        try {
            // Handle comma-separated values
            if (waveformStr.includes(',')) {
                return waveformStr.split(',').map(v => parseFloat(v.trim()));
            }
            // Handle space-separated values
            else if (waveformStr.includes(' ')) {
                return waveformStr.split(/\s+/).map(v => parseFloat(v.trim()));
            }
            // Try JSON parse
            else {
                const parsed = JSON.parse(waveformStr);
                if (Array.isArray(parsed)) return parsed;
                return null;
            }
        } catch (e) {
            return null;
        }
    }

    searchForWaveformData(obj, depth = 0) {
        if (depth > 5) return null; // Prevent infinite recursion
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                
                // Look for lead-like structures
                if (key === 'Lead' || key === 'Leads' || key === 'Waveform') {
                    if (Array.isArray(value)) {
                        const processed = this.processLeadArray(value);
                        if (processed) return processed;
                    }
                }
                
                // Look for numeric arrays that might be waveform data
                if (Array.isArray(value) && value.length > 100 && typeof value[0] === 'number') {
                    return { Lead: [{ LeadID: 'II', Data: value }] };
                }
                
                // Recursively search
                if (typeof value === 'object' && value !== null) {
                    const result = this.searchForWaveformData(value, depth + 1);
                    if (result) return result;
                }
            }
        }
        
        return null;
    }

    expandToStandardLeads(waveformData) {
        // If we have a single lead but it's probably lead II, duplicate for display
        if (waveformData && Array.isArray(waveformData)) {
            return {
                Lead: [
                    { LeadID: 'I', Data: waveformData },
                    { LeadID: 'II', Data: waveformData },
                    { LeadID: 'III', Data: waveformData },
                    { LeadID: 'aVR', Data: waveformData.map(v => -v) },
                    { LeadID: 'aVL', Data: waveformData },
                    { LeadID: 'aVF', Data: waveformData },
                    { LeadID: 'V1', Data: waveformData },
                    { LeadID: 'V2', Data: waveformData },
                    { LeadID: 'V3', Data: waveformData },
                    { LeadID: 'V4', Data: waveformData },
                    { LeadID: 'V5', Data: waveformData },
                    { LeadID: 'V6', Data: waveformData }
                ]
            };
        }
        
        if (waveformData && typeof waveformData === 'object') {
            if (!waveformData.Lead && !waveformData.I && !waveformData.II) {
                // Assume the object itself is lead II
                return {
                    Lead: [{ LeadID: 'II', Data: Object.values(waveformData).filter(v => typeof v === 'number') }]
                };
            }
        }
        
        return waveformData;
    }

    extractRecordingTime(root) {
        const recordingTime = this.getValueByPath(root, 'AcquisitionInfo.AcquisitionTime') ||
                              this.getValueByPath(root, 'Recording.Time') ||
                              new Date().toISOString();
        
        return recordingTime;
    }

    extractInterpretation(root) {
        let interpretation = root.Interpretation || root.Conclusion;
        if (!interpretation) return null;
        
        const sections = [];
        
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
        }
        
        if (interpretation.Finding) {
            const findings = [];
            if (Array.isArray(interpretation.Finding)) {
                interpretation.Finding.forEach(finding => {
                    const desc = finding.Description || finding['#text'] || finding;
                    if (desc) findings.push(desc);
                });
            } else if (interpretation.Finding.Description) {
                findings.push(interpretation.Finding.Description);
            }
            if (findings.length > 0) {
                sections.push({
                    title: 'FINDINGS',
                    items: findings
                });
            }
        }
        
        if (interpretation.Impression) {
            sections.push({
                title: 'IMPRESSION',
                content: interpretation.Impression
            });
        }
        
        if (interpretation.Recommendations) {
            sections.push({
                title: 'RECOMMENDATIONS',
                content: interpretation.Recommendations
            });
        }
        
        return this.formatInterpretation(sections);
    }
}

module.exports = { GEParser };