// gateway/src/services/xml-parsers/vendors/index.js

const { CardioSoftParser } = require('./CardioSoftParser');
const { MindrayParser } = require('./MindrayParser');
const { GEParser } = require('./GEParser');
const { PhilipsParser } = require('./PhilipsParser');

module.exports = {
    CardioSoftParser,
    MindrayParser,
    GEParser,
    PhilipsParser
};