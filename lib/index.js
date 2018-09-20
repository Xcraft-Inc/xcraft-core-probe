'use strict';

const path = require('path');
const watt = require('watt');
const xConfig = require('xcraft-core-etc')().load('xcraft');
const {SQLite} = require('xcraft-core-utils');

const NS_PER_SEC = 1e9;

class Probe extends SQLite {
  constructor() {
    const location = path.join(xConfig.xcraftRoot, 'var/probe');

    super(location);

    this._pushCounter = 0;

    const tables = `
      CREATE TABLE IF NOT EXISTS data (timestamp TEXT, delta TEXT, topic TEXT, payload JSON);
      CREATE INDEX IF NOT EXISTS timestamp ON data (timestamp);
      CREATE INDEX IF NOT EXISTS topic ON data (topic);
    `;

    const queries = {
      begin: `BEGIN`,
      commit: `COMMIT`,
      push: `INSERT INTO data VALUES ($timestamp, 0, $topic, $payload)`,
      delta: `UPDATE data SET delta = $delta WHERE timestamp = $timestamp`,
    };

    const res = super.open('probes', tables, queries);
    if (!res) {
      throw new Error('something wrong happens with with SQLite');
    }

    /* Start the first transaction */
    this.stmts.begin.run();

    watt.wrapAll(this);
  }

  close() {
    this.stmts.commit.run();
    super.close('probes');
  }

  get stmts() {
    return super.stmts.probes;
  }

  /**
   * Push a new time entry in the database.
   *
   * This function returns a function which can be used in order to compute
   * the delta in nanoseconds (it's optional).
   *
   * @param {string} topic - Topic for identifiyng the payload.
   * @param {Object} payload - A custom payload.
   * @return {function} for computing a delta.
   */
  push(topic, payload) {
    if (!this.usable()) {
      throw new Error(`SQLite is not available`);
    }

    if (this._pushCounter === 10000) {
      this.stmts.commit.run();
      this._pushCounter = 0;
      this.stmts.begin.run();
    }

    const timestamp = this.timestamp();

    this.stmts.push.run({timestamp, topic, payload});
    ++this._pushCounter;

    const ptime = process.hrtime();

    return () => {
      const ntime = process.hrtime(ptime);
      const delta = ntime[0] * NS_PER_SEC + ntime[1];
      this.stmts.delta.run({timestamp, delta});
    };
  }
}

module.exports = new Probe();
