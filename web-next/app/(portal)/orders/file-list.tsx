"use client";

import { useState } from "react";
import { CheckIcon, XMarkIcon, ClockIcon } from "lucide-react";
import { FileItem } from "./types";

interface FileListProps {
  files: FileItem[];
  onRemove?: (index: number) => void;
}

export function FileList({ files, onRemove }: FileListProps) {
  const getStatusIcon = (status: FileItem["status"]) => {
    switch (status) {
      case "pending":
        return <ClockIcon className="w-4 h-4 text-yellow-400" />;
      case "uploading":
        return (
          <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />>
        );
      case "success":
        return <CheckIcon className="w-4 h-4 text-green-400" />;
      case "error":
        return <XMarkIcon className="w-4 h-4 text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: FileItem["status"]) => {
    switch (status) {
      case "pending":
        return "text-yellow-400";
      case "uploading":
        return "text-blue-400";
      case "success":
        return "text-green-400";
      case "error":
        return "text-red-400";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-3">
      {files.map((fileItem, index) => (
        <div
          key={fileItem.file.name}
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
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}