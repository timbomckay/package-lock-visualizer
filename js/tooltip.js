const $tip = () => document.getElementById("sankey-tooltip");
let _tipTimer = null;

export function showTip(ev, markup) {
  clearTimeout(_tipTimer);
  const t = $tip();
  t.innerHTML = markup;
  t.style.display = "block";
  t.style.left = ev.clientX + 14 + "px";
  t.style.top = ev.clientY - 8 + "px";
}

export function hideTip() {
  _tipTimer = setTimeout(() => {
    $tip().style.display = "none";
  }, 200);
}

export function initTooltip() {
  const el = document.getElementById("sankey-tooltip");
  el.addEventListener("mouseenter", () => clearTimeout(_tipTimer));
  el.addEventListener("mouseleave", hideTip);
}
