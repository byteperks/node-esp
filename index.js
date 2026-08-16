const { SerialPort } = require('serialport');

const portPath = process.env.PRINTER_PORT || 'COM6';
const baudRateText = process.env.PRINTER_BAUD_RATE || '9600';
const baudRate = Number(baudRateText);

function describeConnection() {
  return `${portPath} at ${baudRateText} baud`;
}

function fail(message, error) {
  console.error(`\nPrinter test failed for ${describeConnection()}.`);
  console.error(message);
  if (error) {
    console.error(`Details: ${error.message || error}`);
  }
  process.exitCode = 1;
}

function closePort(port) {
  return new Promise((resolve, reject) => {
    if (!port.isOpen) {
      resolve();
      return;
    }

    port.close((error) => (error ? reject(error) : resolve()));
  });
}

async function printTestReceipt() {
  if (!Number.isInteger(baudRate) || baudRate <= 0) {
    fail(
      'PRINTER_BAUD_RATE must be a positive whole number (for example, 9600 or 115200).'
    );
    return;
  }

  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  let portError;
  port.on('error', (error) => {
    portError = error;
  });

  try {
    console.log(`Opening printer port ${portPath} at ${baudRate} baud...`);
    await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
    console.log('Port opened. Sending ESC/POS test receipt...');

    const receipt = Buffer.concat([
      Buffer.from([0x1b, 0x40]), // ESC @: initialize printer
      Buffer.from('Chalgaya BSDK \n', 'ascii'),
      Buffer.from([0x0a , 0x0a, 0x0a, 0x0a]) // Feed 4 lines
    ]);

    await new Promise((resolve, reject) => port.write(receipt, (error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => port.drain((error) => (error ? reject(error) : resolve())));

    if (portError) {
      throw portError;
    }

    console.log('Test data sent successfully. Check the printer for the receipt.');
  } catch (error) {
    fail(
      `Could not open or write to the printer. Check that ${portPath} is the Bluetooth outgoing COM port, the printer is powered on, and the baud rate is correct.`,
      error
    );
  } finally {
    try {
      await closePort(port);
      console.log('Printer port closed.');
    } catch (error) {
      fail('The print data may have been sent, but the printer port could not be closed cleanly.', error);
    }
  }
}

printTestReceipt();
