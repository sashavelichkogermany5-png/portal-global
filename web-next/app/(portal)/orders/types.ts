export interface FileItem {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export interface UploadProgress {
  progress: number;
  loaded: number;
  total: number;
}

export interface UploadFileOptions {
  file: File;
  url: string;
  onProgress?: (progress: UploadProgress) => void;
  headers?: Record<string, string>;
  abortSignal?: AbortSignal;
}

export interface UploadedFile {
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  originalName?: string;
}

export interface FileUploadProps {
  onFileSelect: (files: File[]) => void;
  maxFileSize?: number;
  acceptedTypes?: string[];
  multiple?: boolean;
}

export interface FileListProps {
  files: FileItem[];
  onRemove?: (index: number) => void;
}

export interface UseFileUploadReturn {
  uploadQueue: FileItem[];
  abortUpload: (index: number) => void;
}