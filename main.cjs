const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.JOCO_DEV_SERVER_URL);
const JOCO_SAVE_FILTER = [{ name: "John Company saves", extensions: ["joco"] }];
const TEXT_FILTER = [{ name: "Text files", extensions: ["txt"] }];

function success(result) {
  return { status: "success", ...result };
}

function cancel() {
  return { status: "cancel" };
}

function errorResult(error) {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Unknown Electron IPC error.",
  };
}

function parentWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function normalizeSaveContent(content) {
  if (typeof content !== "string") {
    throw new Error("Save content must be a string.");
  }

  return content;
}

function normalizeTextContent(content) {
  if (typeof content !== "string") {
    throw new Error("Text content must be a string.");
  }

  return content;
}

function withExtension(filePath, extension) {
  return path.extname(filePath).toLowerCase() === extension ? filePath : `${filePath}${extension}`;
}

function defaultSavePath(suggestedName, fallbackName) {
  const filename =
    typeof suggestedName === "string" && suggestedName.trim() ? path.basename(suggestedName.trim()) : fallbackName;
  return path.join(app.getPath("documents"), filename);
}

ipcMain.handle("joco:save-game", async (event, content, suggestedName) => {
  try {
    const normalizedContent = normalizeSaveContent(content);
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindowFromEvent(event), {
      title: "Save Game",
      defaultPath: defaultSavePath(suggestedName, "john-company-save.joco"),
      filters: JOCO_SAVE_FILTER,
    });

    if (canceled || !filePath) {
      return cancel();
    }

    const savePath = withExtension(filePath, ".joco");
    await fs.writeFile(savePath, normalizedContent, "utf8");
    return success({ filePath: savePath });
  } catch (error) {
    return errorResult(error);
  }
});

ipcMain.handle("joco:load-game", async (event) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindowFromEvent(event), {
      title: "Load Game",
      properties: ["openFile"],
      filters: JOCO_SAVE_FILTER,
    });

    if (canceled || filePaths.length === 0) {
      return cancel();
    }

    const filePath = filePaths[0];
    if (path.extname(filePath).toLowerCase() !== ".joco") {
      throw new Error("Save file must use the .joco extension.");
    }

    const content = await fs.readFile(filePath, "utf8");
    return success({ filePath, content });
  } catch (error) {
    return errorResult(error);
  }
});

ipcMain.handle("joco:copy-text", async (_event, content) => {
  try {
    clipboard.writeText(normalizeTextContent(content));
    return success({});
  } catch (error) {
    return errorResult(error);
  }
});

ipcMain.handle("joco:save-summary", async (event, content, suggestedName) => {
  try {
    const normalizedContent = normalizeTextContent(content);
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindowFromEvent(event), {
      title: "Save Summary",
      defaultPath: defaultSavePath(suggestedName, "john-company-summary.txt"),
      filters: TEXT_FILTER,
    });

    if (canceled || !filePath) {
      return cancel();
    }

    const summaryPath = withExtension(filePath, ".txt");
    await fs.writeFile(summaryPath, normalizedContent, "utf8");
    return success({ filePath: summaryPath });
  } catch (error) {
    return errorResult(error);
  }
});

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
