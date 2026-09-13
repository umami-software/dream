import { describe, expect, it } from "vitest";
import {
  createBrowserFeedbackAttachment,
  formatElementFeedbackMessage,
  formatElementSource,
  getElementCaptureRect,
} from "./browser-feedback";
import type { InspectedElement } from "./browser-inspector-script";

const element: InspectedElement = {
  ancestors: ["div#root", "main", "form.checkout"],
  attributes: { class: "btn primary", type: "submit" },
  component: {
    components: ["SubmitButton", "CheckoutForm", "App"],
    framework: "react",
    source: {
      columnNumber: 7,
      fileName: "src/components/CheckoutForm.tsx",
      lineNumber: 42,
    },
  },
  html: '<button class="btn primary" type="submit">Place order</button>',
  name: "button.btn.primary",
  rect: { height: 36.4, width: 120, x: 340.2, y: 210 },
  selector: "div#root > main > form > button",
  styles: { color: "rgb(255, 255, 255)", display: "flex", "font-family": "" },
  tagName: "button",
  text: "Place order",
  title: "Checkout",
  url: "http://localhost:3000/checkout",
  viewport: { height: 720, width: 1280 },
};

describe("getElementCaptureRect", () => {
  it("pads the element box and clamps it to the viewport", () => {
    expect(
      getElementCaptureRect({
        rect: { height: 50, width: 100, x: 5, y: 700 },
        viewport: { height: 720, width: 1280 },
      }),
    ).toEqual({ x: 0, y: 688, width: 117, height: 32 });
  });

  it("converts CSS pixels to zoomed device pixels", () => {
    expect(
      getElementCaptureRect(
        {
          rect: { height: 20, width: 40, x: 100, y: 100 },
          viewport: { height: 720, width: 1280 },
        },
        1.5,
        0,
      ),
    ).toEqual({ x: 150, y: 150, width: 60, height: 30 });
  });

  it("returns null for elements outside the viewport", () => {
    expect(
      getElementCaptureRect(
        {
          rect: { height: 20, width: 40, x: 2000, y: 100 },
          viewport: { height: 720, width: 1280 },
        },
        1,
        0,
      ),
    ).toBeNull();
  });
});

describe("formatElementSource", () => {
  it("formats file, line and column when present", () => {
    expect(
      formatElementSource({
        fileName: "a.tsx",
        lineNumber: 3,
        columnNumber: 9,
      }),
    ).toBe("a.tsx:3:9");
    expect(formatElementSource({ fileName: "a.vue" })).toBe("a.vue");
    expect(formatElementSource(null)).toBeNull();
  });
});

describe("formatElementFeedbackMessage", () => {
  it("keeps the comment verbatim and describes the node for the agent", () => {
    const comment = "Make this button full width on mobile.\nKeep the color.";
    expect(formatElementFeedbackMessage({ comment, element })).toBe(
      [
        comment,
        "",
        "Referenced element (from the browser preview):",
        "URL: http://localhost:3000/checkout",
        "Page title: Checkout",
        "Element: button.btn.primary",
        "Selector: div#root > main > form > button",
        "Parents: div#root > main > form.checkout",
        "Size: 120×36 at (340, 210) in a 1280×720 viewport",
        "Component: SubmitButton < CheckoutForm < App (react)",
        "Source: src/components/CheckoutForm.tsx:42:7",
        'Text: "Place order"',
        "Computed styles: color: rgb(255, 255, 255); display: flex",
        "",
        "```html",
        '<button class="btn primary" type="submit">Place order</button>',
        "```",
      ].join("\n"),
    );
  });

  it("omits framework lines and lengthens the fence when markup has backticks", () => {
    const text = formatElementFeedbackMessage({
      comment: "  Why is this empty?  ",
      element: {
        ...element,
        component: null,
        html: "<code>```</code>",
        text: "",
        title: " ",
      },
    });
    expect(text.startsWith("Why is this empty?\n\n")).toBe(true);
    expect(text).not.toContain("Component:");
    expect(text).not.toContain("Source:");
    expect(text).not.toContain("Text:");
    expect(text).not.toContain("Page title:");
    expect(text.endsWith("\n````html\n<code>```</code>\n````")).toBe(true);
  });
});

describe("createBrowserFeedbackAttachment", () => {
  it("builds a PNG file part the chat providers understand", () => {
    expect(
      createBrowserFeedbackAttachment("data:image/png;base64,AA=="),
    ).toEqual({
      filename: "browser-element.png",
      mediaType: "image/png",
      type: "file",
      url: "data:image/png;base64,AA==",
    });
  });
});
