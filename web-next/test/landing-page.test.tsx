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

import Home from "@/app/page";

describe("landing page", () => {
  it("keeps standard and demo auth entry points on the home page", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('href="/login?returnUrl=%2Fapp"');
    expect(markup).toContain('href="/login?demo=1&amp;returnUrl=%2Fapp"');
    expect(markup).toContain("Sign in");
    expect(markup).toContain("Use demo account");
  });
});
