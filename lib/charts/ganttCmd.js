#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ganttName = 'gantt_cmd_report';

const gpConfigure = (txtFile, maxLevel) => `
# Gantt chart
stats '${txtFile}' using 1 nooutput
min_time = STATS_min
stats '${txtFile}' using 2 nooutput
max_time = STATS_max
time_range = max_time - min_time

stats '${txtFile}' using ($2-$1) nooutput
min_duration = STATS_min
max_duration = STATS_max

set terminal eps size 16.54,11.69 color font "Ubuntu Condensed,3"
set output '${ganttName}.eps'

# Settings
set title "Gantt chart - Execution timeline" font "Ubuntu,12"
set xlabel "Time [ms]" font "Ubuntu,10"
set ylabel "Quests" font "Ubuntu,10"

# Axes
set xrange [0:(max_time-min_time+1000)]
set yrange [0.5:${maxLevel + 0.5}]

# Custom Y labels (command's name)
unset ytics

# Grid and style
set xtics 1000
set mxtics 10
set tics scale 1.0, 0.5
set style line 12 dt (0.4,1.5) lc rgb '#BBBBBB' lw 0.3
set style line 13 dt (0.4,1.5) lc rgb '#DDDDDD' lw 0.3
set grid xtics ytics mxtics ls 12, ls 13
set style fill solid 0.8
unset key

# Color by level
set cbrange [min_duration:5000]
set palette defined (0 "#4ECDC4", 0.5 "#FFD93D", 1.0 "#FF6B6B")
`;

const gpCenterLabel = (name, x, level) =>
  `set label "${name}" at ${x},${level} center font "Ubuntu Condensed,3" textcolor rgb "#222222" front noenhanced\n`;

const gpLeftLabel = (name, x, level) =>
  `set label "${name}" at ${x},${level} left font "Ubuntu Condensed,3" textcolor rgb "#777777" front noenhanced\n`;

const gpPlot = (txtFile) => `
# Plot
plot '${txtFile}' using ((($1-min_time)+($2-$1)/2)):3:(($2-$1)/2):(0.45):(($2-$1)) \
     with boxxyerrorbars fillstyle solid 0.8 linecolor palette notitle
`;

class GanttCmdChart {
  #db;
  #txtFile;
  #gpFile;

  constructor(db, outputDir) {
    this.#db = db;
    this.#txtFile = path.join(outputDir, ganttName + '.txt');
    this.#gpFile = path.join(outputDir, ganttName + '.gp');
  }

  generate() {
    const [data, commands] = this.#processTimelineData();

    let content = '';
    for (const [start, end, level, cmd] of data) {
      content += `${start} ${end} ${level} ${cmd}\n`;
    }
    fs.writeFileSync(this.#txtFile, content, 'utf-8');

    this.#createGnuplot(commands, data);
  }

  /**
   * Group commands by name.
   * @returns {[]}
   */
  #processTimelineData() {
    const commands = {}; /* cmd_name -> level */
    let levelCounter = 1;

    const stmt = this.#db.prepare(`
      SELECT tcmd AS timeStart,
            tevt AS timeEnd,
            replace(commands.topic, 'push/', '') AS cmd
      FROM (
        SELECT timestamp AS tcmd,
              topic,
              payload AS id
          FROM data where id IS NOT NULL
          AND topic NOT GLOB '*::*'
      ) AS commands, (
        SELECT timestamp AS tevt,
              topic,
              SUBSTR(topic, -45, 36) AS id
          FROM data
        WHERE topic GLOB '*::*.finished'
            OR topic GLOB '*::*.error'
      ) AS events
      WHERE commands.id = events.id
      ORDER BY tcmd ASC;
    `);

    let ganttData = [];
    for (const line of stmt.iterate()) {
      const {cmd, timeEnd, timeStart} = line;

      if (!(cmd in commands)) {
        commands[cmd] = levelCounter;
        ++levelCounter;
      }

      const level = commands[cmd];
      ganttData.push([parseInt(timeStart), parseInt(timeEnd), level, cmd]);
    }

    /* Reverse level order */
    ganttData = ganttData.map((entry) => {
      entry[2] = levelCounter - entry[2];
      commands[entry[3]] = entry[2];
      return entry;
    });

    return [ganttData, commands];
  }

  /**
   * Create the GNUplot script.
   * @param {*} commands
   * @param {*} data
   */
  #createGnuplot(commands, data) {
    const maxLevel = Object.keys(commands).length;
    let script = gpConfigure(this.#txtFile, maxLevel);

    for (const [cmdName, level] of Object.entries(commands)) {
      const cleanName = cmdName.replace(/"/g, '').replace(/[/]/g, ':');
      script += `set ytics add ("${cleanName}" ${level}) noenhanced\n`;
    }

    /* Group data by level (for smart labels) */
    const dataByLevel = {};
    for (const [start, end, level, cmd] of data) {
      if (!dataByLevel[level]) {
        dataByLevel[level] = [];
      }
      dataByLevel[level].push({start, end, duration: end - start, cmd});
    }

    const minTime = Math.min(...data.map((d) => d[0]));

    /* Add labels for each level (mrepeat the label on the line) */
    for (const [cmd, level] of Object.entries(commands)) {
      const name = cmd.replace(/"/g, '').replace(/[/]/g, ':');
      const boxes = dataByLevel[level] || [];

      if (boxes.length === 0) {
        continue;
      }

      /* Sort by the last time */
      boxes.sort((a, b) => b.start - a.start);

      /* Put a label by group of closed boxes */
      let prevBoxRelativeStart;

      for (const box of boxes) {
        const relativeStart = box.start - minTime;
        const relativeEnd = box.end - minTime;

        /* Prevent overlaps (2s) */
        if (prevBoxRelativeStart - relativeEnd < 2000) {
          continue;
        }

        prevBoxRelativeStart = relativeStart;

        /* Maybe the label can be put in the box */
        const textWidthNeeded = name.length * 60;
        const fitInside = box.duration > textWidthNeeded && box.duration > 500;

        if (fitInside) {
          const xPos = relativeStart + box.duration / 2;
          script += gpCenterLabel(name, xPos, level);
        } else {
          const xPos = relativeEnd + 20;
          script += gpLeftLabel(name, xPos, level);
        }
      }
    }

    script += gpPlot(this.#txtFile);

    fs.writeFileSync(this.#gpFile, script, 'utf-8');
  }
}

module.exports = GanttCmdChart;
