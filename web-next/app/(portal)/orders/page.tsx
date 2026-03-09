"use client";

import { useState } from "react";
import { FileList } from "./file-list";
import { FileUpload } from "./file-upload";
import { useFileUpload } from "./use-file-upload";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];

export default function OrdersPage() {
  const [orderDetails, setOrderDetails] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { uploadQueue } = useFileUpload(selectedFiles, "/api/upload");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.alert(`Order created successfully. Files attached: ${uploadQueue.length}.`);
    setOrderDetails("");
    setSelectedFiles([]);
  };

  const isUploading = uploadQueue.some((file) => file.status === "uploading");

  return (
    <main className="min-h-screen bg-black px-6 py-20 text-white">
      <div className="container mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold mb-4">Create order</h1>
        <p className="mb-8 text-sm text-gray-400">Fill in the details and attach any necessary files.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="mb-2 block text-lg font-medium">Order details</label>
            <textarea
              rows={4}
              value={orderDetails}
              onChange={(event) => setOrderDetails(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
              placeholder="Describe your order..."
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-lg font-medium">Attach files (optional)</label>
            <FileUpload
              onFileSelect={setSelectedFiles}
              maxFileSize={100 * 1024 * 1024}
              acceptedTypes={ACCEPTED_TYPES}
            />
          </div>

          {uploadQueue.length > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
              <h3 className="mb-2 text-sm font-medium">Upload progress</h3>
              <FileList files={uploadQueue} />
            </div>
          )}

          <button
            type="submit"
            disabled={isUploading}
            className="w-full rounded-lg bg-blue-500 px-6 py-3 font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : "Create order"}
          </button>
        </form>
      </div>
    </main>
  );
}
