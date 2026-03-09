"use client";

import { useEffect, useRef, useState } from "react";
import { FileItem, UseFileUploadReturn } from "./types";

const toPendingQueue = (files: File[]): FileItem[] => files.map((file) => ({
  file,
  progress: 0,
  status: "pending"
}));

export function useFileUpload(files: File[], url: string): UseFileUploadReturn {
  const [uploadQueue, setUploadQueue] = useState<FileItem[]>([]);
  const controllersRef = useRef<AbortController[]>([]);

  useEffect(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current = [];

    if (files.length === 0) {
      setUploadQueue([]);
      return;
    }

    let cancelled = false;
    const initialQueue = toPendingQueue(files);
    setUploadQueue(initialQueue);

    const uploadFile = async (file: File, index: number) => {
      const controller = new AbortController();
      controllersRef.current[index] = controller;
      setUploadQueue((current) => current.map((item, itemIndex) => (
        itemIndex === index ? { ...item, status: "uploading" } : item
      )));

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(url, {
          method: "POST",
          body: formData,
          signal: controller.signal,
          credentials: "include"
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message = typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error === "string"
            ? payload.error
            : "Upload failed";
          throw new Error(message);
        }

        if (cancelled) return;
        setUploadQueue((current) => current.map((item, itemIndex) => (
          itemIndex === index ? { ...item, progress: 100, status: "success", error: undefined } : item
        )));
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Upload failed";
        setUploadQueue((current) => current.map((item, itemIndex) => (
          itemIndex === index ? { ...item, status: "error", error: message } : item
        )));
      }
    };

    files.forEach((file, index) => {
      void uploadFile(file, index);
    });

    return () => {
      cancelled = true;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current = [];
    };
  }, [files, url]);

  const abortUpload = (index: number) => {
    const controller = controllersRef.current[index];
    if (controller) {
      controller.abort();
    }
    setUploadQueue((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, status: "error", error: "Upload canceled" } : item
    )));
  };

  return { uploadQueue, abortUpload };
}
