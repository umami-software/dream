import type { FileUIPart } from "ai";
import type { InspectedElement } from "./browser-inspector-script";

export const BROWSER_FEEDBACK_ATTACHMENT_NAME = "browser-element.png";
export const ELEMENT_CAPTURE_PADDING = 12;

export interface CaptureRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Area of the guest view to screenshot for an element: its box plus a little
 * context, clamped to the viewport and converted from CSS pixels to the
 * zoomed device-independent pixels `capturePage` expects.
 */
export function getElementCaptureRect(
  element: Pick<InspectedElement, "rect" | "viewport">,
  zoomFactor = 1,
  padding = ELEMENT_CAPTURE_PADDING,
): CaptureRect | null {
  const { rect, viewport } = element;
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(viewport.width, rect.x + rect.width + padding);
  const bottom = Math.min(viewport.height, rect.y + rect.height + padding);
  if (right - left < 1 || bottom - top < 1) return null;
  return {
    height: Math.max(1, Math.round((bottom - top) * zoomFactor)),
    width: Math.max(1, Math.round((right - left) * zoomFactor)),
    x: Math.round(left * zoomFactor),
    y: Math.round(top * zoomFactor),
  };
}

export function formatElementSource(
  source: NonNullable<InspectedElement["component"]>["source"],
) {
  if (!source) return null;
  const line = source.lineNumber ? `:${source.lineNumber}` : "";
  const column =
    source.lineNumber && source.columnNumber ? `:${source.columnNumber}` : "";
  return `${source.fileName}${line}${column}`;
}

export function formatElementFeedbackMessage({
  comment,
  element,
}: {
  comment: string;
  element: InspectedElement;
}) {
  const lines = [
    "Referenced element (from the browser preview):",
    `URL: ${element.url}`,
    ...(element.title.trim() ? [`Page title: ${element.title.trim()}`] : []),
    `Element: ${element.name}`,
    `Selector: ${element.selector}`,
    ...(element.ancestors.length
      ? [`Parents: ${element.ancestors.join(" > ")}`]
      : []),
    `Size: ${Math.round(element.rect.width)}×${Math.round(element.rect.height)} at (${Math.round(element.rect.x)}, ${Math.round(element.rect.y)}) in a ${element.viewport.width}×${element.viewport.height} viewport`,
  ];
  const component = element.component;
  if (component?.components.length) {
    lines.push(
      `Component: ${component.components.join(" < ")} (${component.framework})`,
    );
  }
  const source = formatElementSource(component?.source ?? null);
  if (source) lines.push(`Source: ${source}`);
  if (element.text) lines.push(`Text: ${JSON.stringify(element.text)}`);
  const styles = Object.entries(element.styles)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  if (styles) lines.push(`Computed styles: ${styles}`);
  // Use a fence longer than any backtick run in the markup.
  const fence = "`".repeat(
    Math.max(
      3,
      ...Array.from(
        element.html.matchAll(/`+/g),
        (match) => match[0].length + 1,
      ),
    ),
  );
  return `${comment.trim()}\n\n${lines.join("\n")}\n\n${fence}html\n${element.html}\n${fence}`;
}

export function createBrowserFeedbackAttachment(dataUrl: string): FileUIPart {
  return {
    filename: BROWSER_FEEDBACK_ATTACHMENT_NAME,
    mediaType: "image/png",
    type: "file",
    url: dataUrl,
  };
}
