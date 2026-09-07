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

  qrWindow = await createQrWindow();

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
    toggleQrWindow();
  });
});

async function createQrWindow(): Promise<BrowserWindow> {
  const qrCode = await QRCode.toString(mdnsUrl, {
    type: "svg",
    width: 190,
    margin: 1,
  });

  const fallbackUrl =
    getLocalUrls()[0] ?? "No local address found";

  const window = new BrowserWindow({
    width: 280,
    height: 360,
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

  const html = `
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
            padding: 24px;

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
            width: 190px;
            height: 190px;
            margin: 16px auto;
          }

          .qr svg {
            display: block;
            width: 100%;
            height: 100%;
          }

          .address {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
          }

          .fallback {
            margin: 6px 0 0;
            font-size: 11px;
            color: #999;
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

        <p class="address">
          ${mdnsUrl}
        </p>

        <p class="fallback">
          ${fallbackUrl}
        </p>
      </body>
    </html>
  `;

  await window.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
  );

  window.on("blur", () => {
    window.hide();
  });

  return window;
}

function toggleQrWindow(): void {
  if (!tray || !qrWindow) {
    return;
  }

  if (qrWindow.isVisible()) {
    qrWindow.hide();
    return;
  }

  positionQrWindow();
  qrWindow.show();
  qrWindow.focus();
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
  return Math.max(min, Math.min(max, value));
}