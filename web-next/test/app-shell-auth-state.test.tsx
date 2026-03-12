import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

import AppPage from "@/app/app/page";

describe("app shell auth state", () => {
  it("does not render authenticated controls before session resolution", () => {
    const markup = renderToStaticMarkup(<AppPage />);

    expect(markup).toContain("Checking session...");
    expect(markup).not.toContain(">Admin<");
    expect(markup).not.toContain("Seed demo");
  });
});
