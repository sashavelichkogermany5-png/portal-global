"use client";

import posthog from "posthog-js";
import { apiJson, getSessionToken } from "./api-client";

export const captureEvent = (eventName: string, properties: Record<string, unknown> = {}) => {
  if (typeof window === "undefined") return;

  try {
    posthog.capture(eventName, properties);
  } catch {}

  if (!getSessionToken()) return;

  void apiJson("/api/events", {
    method: "POST",
    body: JSON.stringify({
      type: eventName,
      payload: properties,
      source: "web-next"
    })
  }).catch(() => {});
};
