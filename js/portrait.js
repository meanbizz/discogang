// Configurable portrait component handling sizing, frames, and fallbacks.
export class Portrait {
  constructor(target, options = {}) {
    this.element = typeof target === "string" ? document.getElementById(target) : target;
    const dataset = this.element?.dataset || {};
    this.options = Object.assign(
      {
        size: dataset.size || "sm",
        framed: dataset.framed !== "false",
      },
      options,
    );
    if (this.element) {
      this.element.classList.add("portrait");
      if (this.options.size) this.element.dataset.size = this.options.size;
      this.element.dataset.framed = this.options.framed ? "true" : "false";
    }
  }

  render(data) {
    if (!this.element) return;
    const url = data && (data.portrait || data.thumbnail || data.image)
      ? (data.portrait || data.thumbnail || data.image)
      : null;
    const name = (data && data.name) || "";

    if (url) {
      this.element.style.setProperty("--portrait", `url("${url}")`);
      this.element.removeAttribute("data-empty");
      this.element.removeAttribute("data-mark");
      this.element.textContent = "";
      return;
    }

    this.element.style.removeProperty("--portrait");
    this.element.setAttribute("data-empty", "true");
    const initial = name ? name.charAt(0) : "";
    this.element.setAttribute("data-mark", initial ? "letter" : "unknown");
    this.element.textContent = initial || (this.options.size === "scene" ? "" : "?");
  }

  clear() {
    if (!this.element) return;
    this.element.style.removeProperty("--portrait");
    this.element.setAttribute("data-empty", "true");
    this.element.setAttribute("data-mark", "unknown");
    this.element.textContent = "";
  }

  static create(options = {}, data = null) {
    const element = document.createElement(options.tag || "div");
    const instance = new Portrait(element, options);
    if (data) instance.render(data);
    return instance;
  }
}

export function paintPortrait(element, data, options = {}) {
  const instance = new Portrait(element, options);
  instance.render(data);
  return instance;
}

export function clearPortrait(element) {
  new Portrait(element).clear();
}
