const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("joco", {
  platform: process.platform,
});
