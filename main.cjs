const { app, BrowserWindow, Menu } = require("electron");
const path = require("node:path");

const isDev = Boolean(process.env.JOCO_DEV_SERVER_URL);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f5f0e6",
    webPreferences: {
      preload: path.join(__dirname, "src/electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    window.loadURL(process.env.JOCO_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
