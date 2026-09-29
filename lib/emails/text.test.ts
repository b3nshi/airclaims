import { describe, expect, it } from "vitest";
import { emailBodyText } from "./text";

describe("emailBodyText", () => {
  it("prefers the text part", () => {
    expect(emailBodyText(" Hello ", "<b>Hi</b>")).toBe("Hello");
  });
  it("strips HTML, scripts and styles", () => {
    const html = '<style>p{}</style><p>Dear Laura,</p><p>We offer a <b>voucher</b>&nbsp;&amp; more.<br>Regards</p><script>alert(1)</script><img src=x onerror=alert(1)>';
    expect(emailBodyText(null, html)).toBe("Dear Laura,\nWe offer a voucher & more.\nRegards");
  });
  it("decodes numeric entities", () => {
    expect(emailBodyText(null, "Caf&#233; &#x20AC;250")).toBe("Café €250");
  });
});
