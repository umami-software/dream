/**
 * Element picker injected into the browser preview page. It behaves like the
 * DevTools "select an element" mode: hovering outlines the node under the
 * pointer with a label, clicking resolves with a description of that node,
 * and Escape resolves with `null`.
 *
 * Executed via `webview.executeJavaScript`, which returns the promise's value.
 */

export interface InspectedElementSource {
  columnNumber?: number;
  fileName: string;
  lineNumber?: number;
}

export interface InspectedElementComponent {
  /** Innermost component first. */
  components: string[];
  framework: "react" | "vue";
  source: InspectedElementSource | null;
}

export interface InspectedElement {
  /** Outermost first, nearest parent last. */
  ancestors: string[];
  attributes: Record<string, string>;
  component: InspectedElementComponent | null;
  html: string;
  /** Short DevTools-style identifier, e.g. `button#save.btn.primary`. */
  name: string;
  /** Position in CSS pixels relative to the page viewport. */
  rect: { height: number; width: number; x: number; y: number };
  selector: string;
  styles: Record<string, string>;
  tagName: string;
  text: string;
  title: string;
  url: string;
  viewport: { height: number; width: number };
}

export const BROWSER_INSPECTOR_CANCEL_SCRIPT = `(() => {
  if (window.__dreamInspector) window.__dreamInspector.cancel();
})();`;

export const BROWSER_INSPECTOR_SCRIPT = `(() => {
  const w = window;
  const doc = document;
  if (w.__dreamInspector) w.__dreamInspector.cancel();
  return new Promise((resolve) => {
    const Z = 2147483647;
    const MARK = "data-dream-inspector";
    const box = doc.createElement("div");
    box.setAttribute(MARK, "");
    box.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:" +
      Z +
      ";box-sizing:border-box;border:1px solid #3b82f6;background:rgba(59,130,246,0.2);border-radius:2px;display:none;";
    const label = doc.createElement("div");
    label.setAttribute(MARK, "");
    label.style.cssText =
      "position:fixed;left:0;top:0;pointer-events:none;z-index:" +
      Z +
      ";font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#fff;background:#1d4ed8;padding:2px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:none;";
    const style = doc.createElement("style");
    style.setAttribute(MARK, "");
    style.textContent = "*{cursor:crosshair!important}";
    doc.documentElement.append(box, label, style);
    let current = null;

    const classesOf = (el) =>
      typeof el.className === "string"
        ? el.className.trim().split(/\\s+/).filter(Boolean)
        : [];
    const shortName = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      const cls = classesOf(el).slice(0, 3);
      if (cls.length) s += "." + cls.join(".");
      return s;
    };
    const cssPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== doc.documentElement) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(part + "#" + CSS.escape(node.id));
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => c.tagName === node.tagName,
          );
          if (siblings.length > 1)
            part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(" > ");
    };
    const componentName = (t) => {
      if (typeof t === "function") return t.displayName || t.name || null;
      if (t && typeof t === "object") {
        if (t.displayName) return t.displayName;
        if (t.render) return t.render.displayName || t.render.name || null;
        if (t.type) return t.type.displayName || t.type.name || null;
      }
      return null;
    };
    const reactInfo = (el) => {
      const key = Object.keys(el).find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$"),
      );
      if (!key) return null;
      let fiber = el[key];
      const components = [];
      let source = null;
      while (fiber && components.length < 8) {
        const name = componentName(fiber.type);
        if (name && !components.includes(name)) components.push(name);
        if (!source && fiber._debugSource) {
          const s = fiber._debugSource;
          source = {
            fileName: s.fileName,
            lineNumber: s.lineNumber,
            columnNumber: s.columnNumber,
          };
        }
        fiber = fiber.return;
      }
      return { framework: "react", components, source };
    };
    const vueInfo = (el) => {
      let cur = el.__vueParentComponent || null;
      if (!cur && el.__vue__ && el.__vue__.$options)
        cur = { type: el.__vue__.$options, parent: null };
      if (!cur) return null;
      const components = [];
      let source = null;
      while (cur && components.length < 8) {
        const t = cur.type || {};
        const name = t.name || t.__name;
        if (name && !components.includes(name)) components.push(name);
        if (!source && t.__file) source = { fileName: t.__file };
        cur = cur.parent;
      }
      return { framework: "vue", components, source };
    };
    const STYLE_KEYS = [
      "display",
      "position",
      "width",
      "height",
      "margin",
      "padding",
      "color",
      "background-color",
      "font-size",
      "font-weight",
      "font-family",
    ];
    const describe = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const styles = {};
      for (const k of STYLE_KEYS) styles[k] = cs.getPropertyValue(k);
      const attributes = {};
      for (const a of Array.from(el.attributes).slice(0, 24))
        attributes[a.name] =
          a.value.length > 200 ? a.value.slice(0, 200) + "…" : a.value;
      let html = el.outerHTML.replace(/\\s+/g, " ").trim();
      if (html.length > 2000) html = html.slice(0, 2000) + "…";
      const text = (el.innerText || el.textContent || "")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, 300);
      const ancestors = [];
      let p = el.parentElement;
      while (p && p !== doc.documentElement && ancestors.length < 6) {
        ancestors.unshift(shortName(p));
        p = p.parentElement;
      }
      return {
        ancestors,
        attributes,
        component: reactInfo(el) || vueInfo(el),
        html,
        name: shortName(el),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        selector: cssPath(el),
        styles,
        tagName: el.tagName.toLowerCase(),
        text,
        title: doc.title,
        url: location.href,
        viewport: { width: w.innerWidth, height: w.innerHeight },
      };
    };
    const highlight = (el) => {
      current = el;
      if (!el) {
        box.style.display = "none";
        label.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = r.left + "px";
      box.style.top = r.top + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
      label.textContent =
        shortName(el) + "  " + Math.round(r.width) + "×" + Math.round(r.height);
      label.style.display = "block";
      const labelTop = r.top > 24 ? r.top - 22 : r.bottom + 4;
      label.style.left = Math.max(0, r.left) + "px";
      label.style.top =
        Math.min(w.innerHeight - 20, Math.max(0, labelTop)) + "px";
    };
    const targetOf = (e) => {
      const el = doc.elementFromPoint(e.clientX, e.clientY);
      return el && !el.hasAttribute(MARK) && el !== doc.documentElement
        ? el
        : null;
    };
    const onMove = (e) => highlight(targetOf(e));
    const onOut = (e) => {
      if (!e.relatedTarget) highlight(null);
    };
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e) => {
      swallow(e);
      finish(current ? describe(current) : null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        swallow(e);
        finish(null);
      }
    };
    const onScroll = () => {
      if (current) highlight(current);
    };
    const opts = { capture: true };
    const finish = (result) => {
      doc.removeEventListener("mousemove", onMove, opts);
      doc.removeEventListener("mouseout", onOut, opts);
      doc.removeEventListener("mousedown", swallow, opts);
      doc.removeEventListener("mouseup", swallow, opts);
      doc.removeEventListener("pointerdown", swallow, opts);
      doc.removeEventListener("click", onClick, opts);
      doc.removeEventListener("keydown", onKey, opts);
      w.removeEventListener("scroll", onScroll, opts);
      box.remove();
      label.remove();
      style.remove();
      delete w.__dreamInspector;
      resolve(result);
    };
    doc.addEventListener("mousemove", onMove, opts);
    doc.addEventListener("mouseout", onOut, opts);
    doc.addEventListener("mousedown", swallow, opts);
    doc.addEventListener("mouseup", swallow, opts);
    doc.addEventListener("pointerdown", swallow, opts);
    doc.addEventListener("click", onClick, opts);
    doc.addEventListener("keydown", onKey, opts);
    w.addEventListener("scroll", onScroll, opts);
    w.__dreamInspector = { cancel: () => finish(null) };
  });
})();`;
