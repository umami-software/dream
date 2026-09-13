import type * as React from "react";
import type { DesktopApi } from "@/types/ide";

declare global {
  interface ElectronWebviewElement extends HTMLElement {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    capturePage?: () => Promise<{ toPNG: () => Uint8Array }>;
    executeJavaScript: (
      code: string,
      userGesture?: boolean,
    ) => Promise<unknown>;
    getTitle: () => string;
    getURL: () => string;
    getWebContentsId: () => number;
    getZoomFactor: () => number;
    goBack: () => void;
    goForward: () => void;
    loadURL: (url: string) => Promise<void>;
    openDevTools: () => void;
    reload: () => void;
    reloadIgnoringCache: () => void;
    setZoomFactor: (factor: number) => void;
    stop: () => void;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<ElectronWebviewElement>,
        ElectronWebviewElement
      > & {
        allowpopups?: boolean | string;
        partition?: string;
        src?: string;
        webpreferences?: string;
      };
    }
  }
}

declare global {
  interface Window {
    dream?: DesktopApi;
  }
}
