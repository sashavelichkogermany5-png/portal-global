"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { FileUploadProps } from "./types";

export function FileUpload({
  onFileSelect,
  maxFileSize = 50 * 1024 * 1024,
  acceptedTypes = [],
  multiple = true
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = (files: File[]) => {
    setError("");

    for (const file of files) {
      if (file.size > maxFileSize) {
        setError(`File '${file.name}' exceeds size limit (${maxFileSize / (1024 * 1024)}MB)`);
        return;
      }

      if (acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
        setError(`File '${file.name}' has invalid type`);
        return;
      }
    }

    onFileSelect(files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(Array.from(event.dataTransfer.files));
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(event.target.files || []));
  };

  const openPicker = () => {
    inputRef.current?.click();
  };

  const acceptedLabel = acceptedTypes.length > 0
    ? acceptedTypes.map((type) => type.split("/")[1] || type).join(", ")
    : "Any file type";

  return (
    <div
      className="border-2 border-gray-700 rounded-lg p-6 text-center transition-all"
      style={{ borderColor: dragActive ? "#4F46E5" : "#374151" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="space-y-4">
        <div className="text-gray-400">
          <Upload className={`mx-auto mb-2 h-12 w-12 ${dragActive ? "text-blue-500" : "text-gray-400"}`} />
          <p className="text-sm font-medium">
            {dragActive ? "Drop files here" : "Drag and drop files here or click to browse"}
          </p>
          <p className="text-xs text-gray-500">Supported: {acceptedLabel}</p>
          <p className="text-xs text-gray-500">Max size: {maxFileSize / (1024 * 1024)}MB</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          onChange={handleFileInput}
          className="hidden"
          accept={acceptedTypes.join(",")}
        />

        {error ? (
          <div className="rounded-lg border border-red-900/30 bg-red-900/20 p-3 text-sm text-red-400">
            <X className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={openPicker}
          className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-white transition hover:bg-gray-800"
        >
          Browse files
        </button>
      </div>
    </div>
  );
}
