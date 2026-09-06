import { app, Menu, Tray } from "electron";
import { networkInterfaces } from "node:os";
import path from "node:path";

let tray: Tray | null = null;

app.whenReady().then(async () => {

  await import("./server.js");

  const iconPath = path.join(
    __dirname,
    "..",
    "assets",
    "tray.ico"
  );

  const address = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address)
      [0];

  tray = new Tray(iconPath);

  const menu = Menu.buildFromTemplate([
    {
      label: `${address}:3000`,
      enabled: false
    },
    {
      type: "separator"
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip("Local Remote");
  tray.setContextMenu(menu);
});