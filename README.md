# Bluetooth ESC/POS Printer Test (Windows)

This project contains a local Express receipt API and a separate ESC/POS serial-printer test.

## Install

1. Install [Node.js 22 LTS](https://nodejs.org/).
2. Open PowerShell in this project folder and install the dependency:

   ```powershell
   npm install
   ```

## Print a receipt through the API

Start the API:

```powershell
npm start
```

Send your POS data to `POST http://localhost:3000/print` as JSON with `mergedOrders` and `orderDetails`. The endpoint sends a plain-text ESC/POS receipt directly to the Bluetooth printer and returns JSON only after the printer accepts the data.

If your app already calculates a Nepali date with `toNepaliDate`, send it as `orderDetails.nepaliDate`; otherwise the endpoint prints `created_at` unchanged.

## Test the COM-port printer directly

Make sure the printer is powered on and paired in Windows, then run:

```powershell
npm run test-printer
```

The defaults are `COM6` and `9600` baud.

If Windows assigned the printer to COM7, use:

```powershell
$env:PRINTER_PORT = "COM7"
npm run test-printer
```

If 9600 produces no output or unreadable output, try 115200:

```powershell
$env:PRINTER_BAUD_RATE = "115200"
npm run test-printer
```

You can set both values together:

```powershell
$env:PRINTER_PORT = "COM7"
$env:PRINTER_BAUD_RATE = "115200"
npm run test-printer
```

The test script reports the selected COM port and baud rate, initializes the printer, prints a test message, feeds four lines, then closes the port. A successful script message means data was sent; confirm the physical test receipt before treating the setup as ready.
