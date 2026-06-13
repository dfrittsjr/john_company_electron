/// <reference types="vite/client" />

type JocoIpcErrorResult = {
  status: "error";
  message: string;
};

type JocoIpcCancelResult = {
  status: "cancel";
};

type JocoSaveGameResult =
  | {
      status: "success";
      filePath: string;
    }
  | JocoIpcCancelResult
  | JocoIpcErrorResult;

type JocoLoadGameResult =
  | {
      status: "success";
      filePath: string;
      content: string;
    }
  | JocoIpcCancelResult
  | JocoIpcErrorResult;

type JocoTextResult =
  | {
      status: "success";
      filePath?: string;
    }
  | JocoIpcCancelResult
  | JocoIpcErrorResult;

interface Window {
  joco?: {
    platform: string;
    saveGame: (content: string, suggestedName?: string) => Promise<JocoSaveGameResult>;
    loadGame: () => Promise<JocoLoadGameResult>;
    copyText: (content: string) => Promise<JocoTextResult>;
    saveSummary: (content: string, suggestedName?: string) => Promise<JocoTextResult>;
  };
}
