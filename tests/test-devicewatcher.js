// scripts/test-xml-parsing.js

const fs = require('fs').promises;
const { XMLParser } = require('fast-xml-parser');

async function testXmlParsing() {
    const xmlContent = await fs.readFile('ecg-data/sample_ecg.xml', 'utf-8');
    
    const parser = new XMLParser({
        ignoreAttributes: false,
        parseAttributeValue: true,
        trimValues: true
    });
    
    const parsed = parser.parse(xmlContent);
    
    console.log('Parsed XML structure:');
    console.log(JSON.stringify(parsed, null, 2));
    
    // Check patient info
    if (parsed.ECGReport?.PatientInfo) {
        console.log('\n✅ Patient Info found:');
        console.log('   MRN:', parsed.ECGReport.PatientInfo.MRN);
        console.log('   Name:', parsed.ECGReport.PatientInfo.FirstName, parsed.ECGReport.PatientInfo.LastName);
    } else {
        console.log('\n❌ Patient Info not found');
        console.log('Available keys:', Object.keys(parsed));
        console.log('Available ECGReport keys:', parsed.ECGReport ? Object.keys(parsed.ECGReport) : 'none');
    }
}

testXmlParsing().catch(console.error);