const { contextBridge, ipcRenderer } = require("electron");

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function optionalString(value, label) {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, label);
}

contextBridge.exposeInMainWorld("joco", {
  platform: process.platform,
  saveGame: (content, suggestedName) =>
    ipcRenderer.invoke(
      "joco:save-game",
      requireString(content, "Save content"),
      optionalString(suggestedName, "Suggested save filename"),
    ),
  loadGame: () => ipcRenderer.invoke("joco:load-game"),
  copyText: (content) => ipcRenderer.invoke("joco:copy-text", requireString(content, "Text content")),
  saveSummary: (content, suggestedName) =>
    ipcRenderer.invoke(
      "joco:save-summary",
      requireString(content, "Summary content"),
      optionalString(suggestedName, "Suggested summary filename"),
    ),
});
