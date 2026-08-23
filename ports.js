const { SerialPort } = require('serialport');

async function findMptII({ silent = false } = {}) {
  const ports = await SerialPort.list();

  if (!silent) {
    console.log('Ports:');
    console.table(
      ports.map(p => ({
        port: p.path,
        manufacturer: p.manufacturer,
        pnpId: p.pnpId
      }))
    );
  }

  // MPT-II is currently COM4, so initially you can identify
  // it by its Bluetooth PNP information.
  const mpt = ports.find(p =>
    p.pnpId?.includes('047F0E101390')
  );

  if (!mpt) {
    if (!silent) console.log('MPT-II not found');
    return null;
  }

  if (!silent) console.log(`MPT-II found on ${mpt.path}`);

  return mpt.path;
}

if (require.main === module) {
  findMptII();
}

module.exports = { findMptII };