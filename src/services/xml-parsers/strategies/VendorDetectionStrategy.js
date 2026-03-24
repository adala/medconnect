// gateway/src/services/xml-parsers/strategies/VendorDetectionStrategy.js

/**
 * Strategy pattern for vendor detection
 * Open/Closed Principle: Easy to add new detection strategies
 */
class VendorDetectionStrategy {
    constructor() {
        this.strategies = [];
    }

    /**
     * Register a detection strategy
     * @param {Object} strategy - Detection strategy
     */
    registerStrategy(strategy) {
        if (strategy && typeof strategy.detect === 'function') {
            this.strategies.push(strategy);
        } else {
            throw new Error('Strategy must have a detect method');
        }
    }

    /**
     * Detect vendor using registered strategies
     * @param {Object} parsedXml - Parsed XML object
     * @param {string} rawContent - Raw XML content
     * @param {Array} parsers - Available parsers
     * @returns {Object|null} Detected parser
     */
    detect(parsedXml, rawContent, parsers) {
        for (const parser of parsers) {
            try {
                if (parser.canParse(parsedXml, rawContent)) {
                    return parser;
                }
            } catch (error) {
                console.error(`Detection error for ${parser.getVendorName()}:`, error.message);
            }
        }
        return null;
    }

    /**
     * Get strategy info
     * @returns {Object}
     */
    getInfo() {
        return {
            strategiesCount: this.strategies.length,
            strategies: this.strategies.map(s => s.constructor.name)
        };
    }
}

// Specific detection strategies (can be extended)
class RootElementStrategy {
    detect(parsedXml, parser) {
        return parser.canParse(parsedXml, '');
    }
}

class NamespaceStrategy {
    detect(parsedXml, rawContent, parser) {
        return parser.canParse(parsedXml, rawContent);
    }
}

module.exports = {
    VendorDetectionStrategy,
    RootElementStrategy,
    NamespaceStrategy
};