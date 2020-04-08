'use strict';

const xProbe = require('.');

const cmd = {};

cmd.enable = function (msg, resp) {
  const enabled = xProbe.setEnable(true);
  resp.log.info(`probes ${enabled ? 'enabled' : 'disabled'}`);
  if (enabled) {
    resp.log.info(`output probe database: ${xProbe.getLocation()}`);
  }
  resp.events.send(`probe.enable.${msg.id}.finished`);
};

cmd.disable = function (msg, resp) {
  const enabled = xProbe.setEnable(false);
  resp.log.info(`probes ${enabled ? 'enabled' : 'disabled'}`);
  resp.events.send(`probe.disable.${msg.id}.finished`);
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: {
      enable: {
        parallel: true,
        desc: 'enable probes',
      },
      disable: {
        parallel: true,
        desc: 'disable probes',
      },
    },
  };
};
