'use strict';

/** The computer, for the Optimisation tab: RAM, CPU, system (and the GPU from Electron when available). */

const os = require('node:os');

function systemInfo(gpu = null) {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    cpuModel: cpus[0]?.model?.trim() ?? 'Nieznany procesor',
    cpuCores: cpus.length,
    gpu,
  };
}

module.exports = { systemInfo };
