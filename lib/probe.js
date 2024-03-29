'use strict';

const path = require('path');
const etc = require('xcraft-core-etc')();
const {SQLite} = require('xcraft-core-book');

const NS_PER_SEC = 1e9;

class Probe extends SQLite {
  constructor() {
    const xConfig = etc ? etc.load('xcraft') : null;

    if (!xConfig) {
      super(null, true);
      this._pushCounter = 0;
      this._disabled = true;
      return;
    }

    const location = path.join(xConfig.xcraftRoot, 'var/probe');

    const xcraftProbe =
      process.env.XCRAFT_PROBE && parseInt(process.env.XCRAFT_PROBE) !== 0;

    super(location, !xcraftProbe);

    this._pushCounter = 0;
    this._disabled = true;

    const {appArgs} = require('xcraft-core-host');
    const {tribe} = appArgs();

    this._dbName = `probe-${tribe || 0}`;

    if (xcraftProbe) {
      this.open();
    } else {
      this.close();
    }
  }

  _init(skip) {
    if (skip) {
      return;
    }

    if (this._disabled) {
      this.open();
    } else {
      this.close();
    }
  }

  setEnable(en) {
    if (en) {
      super.setEnable(true);
      this.open();
    } else {
      this.close();
      super.setEnable(false);
    }

    return this.isAvailable();
  }

  open() {
    if (!this._disabled || !super.usable()) {
      return;
    }

    const tables = `
      CREATE TABLE IF NOT EXISTS data (timestamp TEXT, delta TEXT, topic TEXT, payload JSON);
      CREATE INDEX IF NOT EXISTS timestamp ON data (timestamp);
      CREATE INDEX IF NOT EXISTS topic ON data (topic);
    `;

    const queries = {
      begin: `BEGIN EXCLUSIVE`,
      commit: `COMMIT`,
      push: `INSERT INTO data VALUES ($timestamp, 0, $topic, $payload)`,
      delta: `UPDATE data SET delta = $delta WHERE timestamp = $timestamp`,
    };

    try {
      const res = super.open(
        this._dbName,
        tables,
        queries,
        /* onOpen */ () => {
          super.exec(this._dbName, 'PRAGMA journal_mode = WAL');
        }
      );
      if (!res) {
        throw new Error('something wrong happens with with SQLite');
      }
      this._disabled = false;

      /* Start the first transaction */
      this.stmts.begin.run();
    } catch (ex) {
      /* ... */
    }
  }

  close() {
    if (!this.isAvailable()) {
      return;
    }
    this._disabled = true;
    this.stmts.commit.run();
    super.close(this._dbName);
  }

  isAvailable() {
    return this._disabled ? false : super.usable();
  }

  get stmts() {
    return super.stmts(this._dbName);
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
    if (!this.isAvailable()) {
      return () => {};
    }

    if (this._pushCounter === 10000) {
      this.stmts.commit.run();
      this._pushCounter = 0;
      this.stmts.begin.run();
    }

    const timestamp = new Date().getTime().toFixed(0);

    this.stmts.push.run({timestamp, topic, payload});
    ++this._pushCounter;

    const ptime = process.hrtime();

    return () => {
      const ntime = process.hrtime(ptime);
      const delta = (ntime[0] * NS_PER_SEC + ntime[1]).toFixed(0);
      this.stmts.delta.run({timestamp, delta});
    };
  }
}

module.exports = new Probe();

process.on('exit', () => module.exports.close());
