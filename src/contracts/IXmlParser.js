// gateway/src/contracts/IXmlParser.js

/**
 * Interface for XML parsers
 * Following Interface Segregation Principle (ISP)
 */
class IXmlParser {
    /**
     * Parse XML file and extract ECG data
     * @param {string} filePath - Path to XML file
     * @param {Object} options - Additional parsing options
     * @returns {Promise<Object>} Parsed ECG data
     */
    async parse(filePath, options = {}) {
        throw new Error('Method not implemented');
    }

    /**
     * Detect if this parser can handle the given XML content
     * @param {Object} parsedXml - Parsed XML object
     * @param {string} rawContent - Raw XML content
     * @returns {boolean} True if parser can handle this format
     */
    canParse(parsedXml, rawContent) {
        throw new Error('Method not implemented');
    }

    /**
     * Get vendor name
     * @returns {string} Vendor name
     */
    getVendorName() {
        throw new Error('Method not implemented');
    }

    /**
     * Validate extracted data
     * @param {Object} data - Extracted data
     * @returns {Object} Validation result
     */
    validate(data) {
        throw new Error('Method not implemented');
    }

    /**
     * Get parser version
     * @returns {string} Version
     */
    getVersion() {
        return '1.0.0';
    }
}

module.exports = { IXmlParser };