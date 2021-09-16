'use strict';

try {
  require('xcraft-core-book');
  module.exports = require('./probe.js');
} catch (ex) {
  if (ex.code !== 'MODULE_NOT_FOUND') {
    throw ex;
  }
  module.exports = null;
}
