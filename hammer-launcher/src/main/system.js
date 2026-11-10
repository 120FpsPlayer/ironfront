'use strict';

/** The computer, for the Optimisation tab: RAM, CPU, system (and the GPU from Electron when available). */

const os = require('node:os');

/** gpu: the card's name, or { name, devices: [names of every graphics card] } on computers with more than one. */
function systemInfo(gpu = null) {
  const cpus = os.cpus();
  const card = gpu && typeof gpu === 'object' ? gpu : { name: gpu, devices: [] };
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    cpuModel: cpus[0]?.model?.trim() ?? 'Nieznany procesor',
    cpuCores: cpus.length,
    gpu: card.name || card.devices?.[0] || null,
    gpus: [...new Set([card.name, ...(card.devices ?? [])].filter(Boolean))],
  };
}

module.exports = { systemInfo };
