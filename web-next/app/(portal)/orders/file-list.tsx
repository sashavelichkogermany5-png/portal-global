"use client";

import { Check, Clock3, X } from "lucide-react";
import { FileItem } from "./types";

interface FileListProps {
  files: FileItem[];
  onRemove?: (index: number) => void;
}

export function FileList({ files, onRemove }: FileListProps) {
  const getStatusIcon = (status: FileItem["status"]) => {
    switch (status) {
      case "pending":
        return <Clock3 className="w-4 h-4 text-yellow-400" />;
      case "uploading":
        return (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        );
      case "success":
        return <Check className="w-4 h-4 text-green-400" />;
      case "error":
        return <X className="w-4 h-4 text-red-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3">
      {files.map((fileItem, index) => (
        <div
          key={`${fileItem.file.name}-${index}`}
          className="bg-gray-900 border border-gray-700 rounded-lg p-3 flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            {getStatusIcon(fileItem.status)}
            <div>
              <div className="font-medium">{fileItem.file.name}</div>
              <div className="text-sm text-gray-400">
                {Math.round(fileItem.file.size / 1024)} KB
                {fileItem.status === "uploading" && (
                  <span className="text-xs text-gray-500 ml-2">
                    ({Math.round(fileItem.progress)}%)
                  </span>
                )}
              </div>
              {fileItem.error && (
                <div className="text-xs text-red-400">
                  {fileItem.error}
                </div>
              )}
            </div>
          </div>

          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="p-1 text-gray-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
