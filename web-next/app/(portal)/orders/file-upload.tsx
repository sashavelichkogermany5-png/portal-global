"use client";

import { useState } from "react";
import { CheckIcon, UploadIcon, XMarkIcon } from "lucide-react";
import { FileUploadProps } from "./types";

export function FileUpload({ 
  onFileSelect, 
  maxFileSize = 50 * 1024 * 1024, // 50MB by default
  acceptedTypes = [],
  multiple = true
}: FileUploadProps) {

export function FileUpload({ 
  onFileSelect, 
  maxFileSize = 50 * 1024 * 1024, // 50MB by default
  acceptedTypes = []
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
  };

  const handleFiles = (files: File[]) => {
    setError('');

    // Validate files
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

  return (
    <div className="border-2 border-gray-700 rounded-lg p-6 text-center transition-all"
         style={{ borderColor: dragActive ? '#4F46E5' : '#374151' }}
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}
    >
      <div className="space-y-4">
        <div className="text-gray-400">
          {dragActive ? (
            <UploadIcon className="w-12 h-12 mx-auto mb-2 text-blue-500" />
          ) : (
            <UploadIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          )}
          <p className="text-sm font-medium">
            {dragActive ? "Drop files here" : "Drag & drop files here or click to browse"}
          </p>
          <p className="text-xs text-gray-500">
            {acceptedTypes.length > 0 
              ? `Supported: ${acceptedTypes.map(t >> t.split('/')[1]).join(", ")}`
              : "Any file type"}
          </p>
          <p className="text-xs text-gray-500">
            Max size: {maxFileSize / (1024 * 1024)}MB
          </p>
        </div>

        <input
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
          accept={acceptedTypes.join(",")}
        />

        {error ? (
          <div className="bg-red-900/20 border border-red-900/30 rounded-lg p-3 text-red-400 text-sm">
            <XMarkIcon className="w-4 h-4 mr-2 inline" />
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => document.querySelector('input[type="file"]')?.click()}
          className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white hover:bg-gray-800 transition"
        >
          Browse files
        </button>
      </div>
    </div>
  );
}