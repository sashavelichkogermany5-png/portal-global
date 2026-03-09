import fs from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

export interface UploadedFile {
  filename: string;
  path: string;
  size: number;
  mimetype: string;
}

type UploadFileLike = {
  name?: string;
  filename?: string;
  type?: string;
  headers?: Headers;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  stream?: () => ReadableStream<Uint8Array>;
  pipe?: (dest: NodeJS.WritableStream) => void;
};

const resolveOriginalName = (file: UploadFileLike) => {
  return file.name || file.filename || "upload.bin";
};

const resolveMimeType = (file: UploadFileLike) => {
  if (file.type) return file.type;
  if (file.headers && typeof file.headers.get === "function") {
    const headerValue = file.headers.get("content-type");
    if (headerValue) return headerValue;
  }
  return "application/octet-stream";
};

const writeFromArrayBuffer = async (filePath: string, file: UploadFileLike) => {
  if (typeof file.arrayBuffer !== "function") {
    throw new Error("arrayBuffer is not available");
  }
  const arrayBuffer = file.arrayBuffer;
  const buffer = Buffer.from(await arrayBuffer());
  await fsPromises.writeFile(filePath, buffer);
};

const writeFromPipe = async (filePath: string, file: UploadFileLike) => {
  if (typeof file.pipe !== "function") {
    throw new Error("pipe is not available");
  }
  const pipe = file.pipe;
  await new Promise<void>((resolve, reject) => {
    const dest = fs.createWriteStream(filePath);
    dest.on("finish", () => resolve());
    dest.on("error", (error) => reject(error));
    pipe(dest);
  });
};

const writeFromStream = async (filePath: string, file: UploadFileLike) => {
  if (typeof file.stream !== "function") {
    throw new Error("stream is not available");
  }
  const stream = file.stream;
  if (typeof Readable.fromWeb !== "function") {
    throw new Error("Readable.fromWeb is not available");
  }
  const webStream = stream() as unknown as Parameters<typeof Readable.fromWeb>[0];
  const readable = Readable.fromWeb(webStream);
  const dest = fs.createWriteStream(filePath);
  await pipeline(readable, dest);
};

const writeFilePayload = async (filePath: string, file: UploadFileLike) => {
  const errors: string[] = [];
  if (typeof file.arrayBuffer === "function") {
    try {
      await writeFromArrayBuffer(filePath, file);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (typeof file.pipe === "function") {
    try {
      await writeFromPipe(filePath, file);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (typeof file.stream === "function") {
    try {
      await writeFromStream(filePath, file);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const suffix = errors.length ? ": " + errors.join("; ") : "";
  throw new Error("Unsupported file payload" + suffix);
};

export async function fileUpload(file: UploadFileLike) {
  // Create upload directory if it doesn't exist
  try {
    await fsPromises.access(UPLOAD_DIR);
  } catch {
    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });
  }

  // Generate unique filename
  const originalName = resolveOriginalName(file);
  const extension = originalName.split(".").pop() || "";
  const uniqueName = Date.now() + "_" + Math.random().toString(36).substr(2, 9) + "." + extension;
  const filePath = join(UPLOAD_DIR, uniqueName);

  // Save file
  await writeFilePayload(filePath, file);

  // Get file stats
  const stats = await fsPromises.stat(filePath);

  return {
    filename: uniqueName,
    path: "/uploads/" + uniqueName,
    size: stats.size,
    mimetype: resolveMimeType(file)
  };
}

export async function deleteFile(filename: string): Promise<boolean> {
  const filePath = join(UPLOAD_DIR, filename);
  
  try {
    await fsPromises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(): Promise<UploadedFile[]> {
  try {
    const files = await fsPromises.readdir(UPLOAD_DIR);
    const result: UploadedFile[] = [];

    for (const filename of files) {
      const filePath = join(UPLOAD_DIR, filename);
      const stats = await fsPromises.stat(filePath);
      
      result.push({
        filename,
        path: "/uploads/" + filename,
        size: stats.size,
        mimetype: "application/octet-stream" // Could be detected
      });
    }

    return result;
  } catch {
    return [];
  }
}
