// gateway/src/config/di/container.js

const awilix = require('awilix');
const { createContainer, asClass, asValue, asFunction, InjectionMode } = awilix;

// Import services
const { ConfigurableXmlParser } = require('../../services/xml-parsers/ConfigurableXmlParser');
const { XmlParserFactory } = require('../../services/xml-parsers/factory/XmlParserFactory');
const { VendorDetectionStrategy } = require('../../services/xml-parsers/strategies/VendorDetectionStrategy');

// Import all vendor parsers
const {
    CardioSoftParser,
    MindrayParser,
    GEParser,
    PhilipsParser
} = require('../../services/xml-parsers/vendors');

// Import base parser
const { BaseXmlParser } = require('../../services/xml-parsers/base/BaseXmlParser');

/**
 * Configure dependency injection container
 */
function ConfigureContainer() {
    const container = createContainer({
        injectionMode: InjectionMode.PROXY,
        strict: false // Enable strict mode to catch resolution errors early
    });

    // Register core services (order matters)
    container.register({
        // Factory must be registered first
        xmlParserFactory: asClass(XmlParserFactory).singleton(),

        // Core services
        vendorDetectionStrategy: asClass(VendorDetectionStrategy).singleton(),
        configurableXmlParser: asClass(ConfigurableXmlParser).singleton(),

        // Base classes
        baseXmlParser: asClass(BaseXmlParser),

        // Vendor parsers
        cardioSoftParser: asClass(CardioSoftParser).singleton(),
        mindrayParser: asClass(MindrayParser).singleton(),
        geParser: asClass(GEParser).singleton(),
        philipsParser: asClass(PhilipsParser).singleton()
    });

    // Register parsers with factory (after factory is resolved)
    // Get the factory and register parsers
    const factory = container.resolve('xmlParserFactory');

    // Register all parsers with the factory
    factory.registerParser('CardioSoft', CardioSoftParser);
    factory.registerParser('Mindray', MindrayParser);
    factory.registerParser('GE_MUSE', GEParser);
    factory.registerParser('Philips_IntelliSpace', PhilipsParser);

    console.log('✅ Registered parsers:', factory.getRegisteredParsers());

    return container;
}

module.exports = { ConfigureContainer };