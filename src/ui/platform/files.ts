// Browser replacements for the old Electron file dialogs. Every function works in
// Chrome, Firefox, and Safari; Chromium browsers additionally get a real
// "Save as" dialog through the File System Access API.

export type FileWriteResult =
  | { status: "saved"; fileName: string }
  | { status: "downloaded"; fileName: string }
  | { status: "cancel" }
  | { status: "error"; message: string };

export type FileReadResult =
  | { status: "success"; fileName: string; content: string }
  | { status: "cancel" }
  | { status: "error"; message: string };

export type CopyResult = { status: "success" } | { status: "error"; message: string };

type TextFileType = {
  description: string;
  mimeType: string;
  extension: `.${string}`;
};

export const JOCO_FILE_TYPE: TextFileType = {
  description: "John Company save",
  mimeType: "application/json",
  extension: ".joco",
};

export const TEXT_FILE_TYPE: TextFileType = {
  description: "Text file",
  mimeType: "text/plain",
  extension: ".txt",
};

// Minimal typing for the Chromium-only File System Access save picker; it is not in
// TypeScript's DOM lib.
type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
};
type WritableFileHandle = {
  name: string;
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};
type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<WritableFileHandle>;
};

export async function saveTextFile(
  content: string,
  suggestedName: string,
  fileType: TextFileType = JOCO_FILE_TYPE,
): Promise<FileWriteResult> {
  const fileName = withExtension(suggestedName, fileType.extension);
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: fileType.description,
            accept: { [fileType.mimeType]: [fileType.extension] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { status: "saved", fileName: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "cancel" };
      }
      // Pickers can be blocked (e.g. inside iframes); fall back to a plain download.
    }
  }

  try {
    downloadText(content, fileName, fileType.mimeType);
    return { status: "downloaded", fileName };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Could not download the file.") };
  }
}

export function openTextFile(fileType: TextFileType = JOCO_FILE_TYPE): Promise<FileReadResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileType.extension;
    input.style.display = "none";

    const finish = (result: FileReadResult) => {
      input.remove();
      resolve(result);
    };

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        finish({ status: "cancel" });
        return;
      }

      try {
        finish({ status: "success", fileName: file.name, content: await file.text() });
      } catch (error) {
        finish({ status: "error", message: errorMessage(error, "Could not read the file.") });
      }
    });
    // Browsers without the "cancel" event leave this promise pending, which is harmless.
    input.addEventListener("cancel", () => finish({ status: "cancel" }));

    // Safari only opens pickers for inputs that are attached to the document.
    document.body.append(input);
    input.click();
  });
}

export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { status: "success" };
    }
  } catch {
    // Fall through to the legacy path, e.g. when clipboard permission is denied.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    return copied
      ? { status: "success" }
      : { status: "error", message: "The browser blocked clipboard access." };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "The browser blocked clipboard access.") };
  } finally {
    textarea.remove();
  }
}

function downloadText(content: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function withExtension(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
