// gateway/src/services/xml-parsers/factory/XmlParserFactory.js

/**
 * Factory for creating XML parsers
 * Single Responsibility: Only responsible for creating parser instances
 * Dependency Inversion: Depends on abstractions, not concretions
 */
class XmlParserFactory {
    constructor() {
        this.parsers = new Map();
        this.parserInstances = new Map(); // Cache instances
    }

    /**
     * Register a parser with the factory
     * @param {string} name - Parser name
     * @param {Function} parserClass - Parser class constructor
     */
    registerParser(name, parserClass) {
        if (!name || !parserClass) {
            throw new Error('Parser name and class are required');
        }
        
        if (this.parsers.has(name)) {
            console.warn(`Parser ${name} is being overwritten`);
        }
        
        this.parsers.set(name, parserClass);
        console.log(`✅ Registered parser: ${name}`);
    }

    /**
     * Create a parser instance by name
     * @param {string} name - Parser name
     * @returns {Object} Parser instance
     */
    createParser(name) {
        // Return cached instance if available
        if (this.parserInstances.has(name)) {
            return this.parserInstances.get(name);
        }
        
        const ParserClass = this.parsers.get(name);
        if (!ParserClass) {
            throw new Error(`Parser not found: ${name}. Available parsers: ${Array.from(this.parsers.keys()).join(', ')}`);
        }
        
        try {
            // Create new instance
            const instance = new ParserClass();
            this.parserInstances.set(name, instance);
            return instance;
        } catch (error) {
            console.error(`Error creating parser ${name}:`, error.message);
            throw new Error(`Failed to create parser ${name}: ${error.message}`);
        }
    }

    /**
     * Get all available parser instances
     * @returns {Array} Array of parser instances
     */
    getAllParsers() {
        const parsers = [];
        for (const [name] of this.parsers) {
            try {
                parsers.push(this.createParser(name));
            } catch (error) {
                console.error(`Failed to create parser ${name}:`, error.message);
            }
        }
        return parsers;
    }

    /**
     * Detect appropriate parser for XML content
     * @param {Object} parsedXml - Parsed XML object
     * @param {string} rawContent - Raw XML content
     * @returns {Object|null} Detected parser
     */
    detectParser(parsedXml, rawContent) {
        const allParsers = this.getAllParsers();
        
        for (const parser of allParsers) {
            try {
                if (parser.canParse(parsedXml, rawContent)) {
                    return parser;
                }
            } catch (error) {
                console.error(`Error checking parser ${parser.getVendorName()}:`, error.message);
            }
        }
        
        return null;
    }

    /**
     * Get list of registered parser names
     * @returns {Array}
     */
    getRegisteredParsers() {
        return Array.from(this.parsers.keys());
    }
}

module.exports = { XmlParserFactory };