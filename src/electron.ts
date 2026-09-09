import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  screen,
  Tray,
} from "electron";
import path from "node:path";
import QRCode from "qrcode";

import {
  getLocalUrls,
  mdnsUrl,
} from "./network.js";
import { auth } from "./auth.js";

let tray: Tray | null = null;
let qrWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  await import("./server.js");

  const iconPath = path.join(
    __dirname,
    "..",
    "assets",
    "tray.ico",
  );

  tray = new Tray(iconPath);
  qrWindow = createQrWindow();

  const menu = Menu.buildFromTemplate([
    {
      label: mdnsUrl,
      enabled: false,
    },
    {
      label: "Copy address",
      click: () => {
        clipboard.writeText(mdnsUrl);
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Local Remote");
  tray.setContextMenu(menu);

  tray.on("click", () => {
    void togglePairingWindow();
  });
});

function createQrWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 300,
    height: 470,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.on("blur", () => {
    setTimeout(() => {
      if (window.isVisible()) {
        hidePairingWindow();
      }
    }, 100);
  });

  return window;
}

async function togglePairingWindow(): Promise<void> {
  if (!qrWindow) {
    return;
  }

  if (qrWindow.isVisible()) {
    hidePairingWindow();
    return;
  }

  await showPairingWindow();
}

async function showPairingWindow(): Promise<void> {
  if (!qrWindow) {
    return;
  }

  const localUrl = getLocalUrls()[0];

  if (!localUrl) {
    console.error(
      "[electron] No local network address found",
    );

    return;
  }

  const {
    secret,
    code,
  } = auth.openPairingWindow();

  try {
    const pairingUrl =
      `${localUrl}/#pair=${encodeURIComponent(secret)}`;

    const qrCode = await QRCode.toString(
      pairingUrl,
      {
        type: "svg",
        width: 180,
        margin: 1,
      },
    );

    const html = createQrHtml(
      qrCode,
      mdnsUrl,
      localUrl,
      code,
    );

    await qrWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
    );

    positionQrWindow();

    qrWindow.show();
    qrWindow.focus();

    console.log(
      "[electron] QR window opened",
    );
  } catch (error) {
    auth.closePairingWindow();

    console.error(
      "[electron] Failed to open QR window:",
      error,
    );

    throw error;
  }
}

function hidePairingWindow(): void {
  if (!qrWindow) {
    return;
  }

  qrWindow.hide();

  console.log(
    "[electron] QR window closed",
  );

  auth.closePairingWindow();
}

function positionQrWindow(): void {
  if (!tray || !qrWindow) {
    return;
  }

  const trayBounds = tray.getBounds();
  const windowBounds = qrWindow.getBounds();

  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  const { workArea } = display;

  let x =
    trayBounds.x +
    trayBounds.width / 2 -
    windowBounds.width / 2;

  let y =
    trayBounds.y -
    windowBounds.height -
    8;

  x = clamp(
    x,
    workArea.x,
    workArea.x +
      workArea.width -
      windowBounds.width,
  );

  y = clamp(
    y,
    workArea.y,
    workArea.y +
      workArea.height -
      windowBounds.height,
  );

  qrWindow.setPosition(
    Math.round(x),
    Math.round(y),
    false,
  );
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function createQrHtml(
  qrCode: string,
  mdnsAddress: string,
  fallbackAddress: string,
  pairingCode: string,
): string {
  const formattedCode =
    `${pairingCode.slice(0, 3)} ${pairingCode.slice(3)}`;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 22px;

            font-family:
              system-ui,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif;

            text-align: center;
            color: #111;
            background: #fff;
          }

          h1 {
            margin: 0;
            font-size: 18px;
          }

          .hint {
            margin: 5px 0 0;
            font-size: 13px;
            color: #666;
          }

          .qr {
            width: 180px;
            height: 180px;
            margin: 14px auto 12px;
          }

          .qr svg {
            display: block;
            width: 100%;
            height: 100%;
          }

          .section {
            margin-top: 14px;
          }

          .label {
            margin: 0 0 4px;
            font-size: 11px;
            color: #777;
          }

          .pairing-code {
            margin: 0;

            font-size: 24px;
            font-weight: 700;
            letter-spacing: 0.12em;
          }

          .address {
            margin: 0;

            font-size: 13px;
            font-weight: 600;
            word-break: break-all;
          }

          .fallback {
            margin: 4px 0 0;

            font-size: 11px;
            color: #999;
            word-break: break-all;
          }
        </style>
      </head>

      <body>
        <h1>Local Remote</h1>

        <p class="hint">
          Scan to connect
        </p>

        <div class="qr">
          ${qrCode}
        </div>

        <div class="section">
          <p class="label">
            Open or install manually
          </p>

          <p class="address">
            ${mdnsAddress}
          </p>
        </div>

        <div class="section">
          <p class="label">
            Pairing code
          </p>

          <p class="pairing-code">
            ${formattedCode}
          </p>
        </div>

        <div class="section">
          <p class="label">
            Can't open the address?
          </p>

          <p class="fallback">
            ${fallbackAddress}
          </p>
        </div>
      </body>
    </html>
  `;
}
