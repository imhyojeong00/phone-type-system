(() => {
  "use strict";

  const TOUCH = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const root = document.documentElement;
  root.classList.add(TOUCH ? "touch-ui" : "desk-ui");
  if (!TOUCH) return;

  const $ = (id) => document.getElementById(id);
  const bar = $("ui-bar");
  const input = $("key-capture");
  const tools = $("top-tools");

  input.readOnly = true;
  input.setAttribute("inputmode", "none");
  input.removeAttribute("autofocus");
  input.tabIndex = -1;

  const ROWS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M", "back"],
    ["prev", "next", "front", "out", "in"],
  ];
  const FN = {
    back: ["⌫", "Delete last phone"],
    prev: ["‹", "Previous phone"],
    next: ["›", "Next phone"],
    front: ["⟲", "Front view"],
    out: ["−", "Zoom out"],
    in: ["+", "Zoom in"],
  };

  const toggle = document.createElement("button");
  toggle.id = "kbd-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Hide keyboard");
  toggle.textContent = "▾";
  bar.appendChild(toggle);

  const kbd = document.createElement("div");
  kbd.id = "kbd";
  kbd.setAttribute("role", "group");
  kbd.setAttribute("aria-label", "Phone keyboard");
  ROWS.forEach((row, ri) => {
    const r = document.createElement("div");
    r.className = "kbd-row" + (ri === 3 ? " kbd-nav" : "");
    row.forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key" + (FN[k] ? " key-fn key-" + k : "");
      b.dataset.key = k;
      b.textContent = FN[k] ? FN[k][0] : k;
      if (FN[k]) b.setAttribute("aria-label", FN[k][1]);
      r.appendChild(b);
    });
    kbd.appendChild(r);
  });
  bar.appendChild(kbd);

  function step(dir) {
    if (!items.length) return;
    const cur = focusIdx < 0 ? items.length - 1 : focusIdx;
    focusOn(Math.max(0, Math.min(items.length - 1, cur + dir)));
  }

  function press(k) {
    if (k.length === 1) typeKey(k);
    else if (k === "back") undoLast();
    else if (k === "prev") step(-1);
    else if (k === "next") step(1);
    else if (k === "front") {
      viewThetaGoal = VIEW_THETA + Math.round((viewThetaGoal - VIEW_THETA) / (Math.PI * 2)) * Math.PI * 2;
      viewPhiGoal = VIEW_PHI;
      zoomK = 1;
    }
    else if (k === "out") zoomK = Math.min(4, zoomK * 1.25);
    else if (k === "in") zoomK = Math.max(0.35, zoomK / 1.25);
  }

  let holdTimer = null;
  let holdRepeat = null;
  const stopHold = () => {
    clearTimeout(holdTimer);
    clearInterval(holdRepeat);
    holdTimer = holdRepeat = null;
  };

  kbd.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".key");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    Sound.init();
    b.classList.add("pressed");
    const k = b.dataset.key;
    press(k);
    if (k === "prev" || k === "next" || k === "in" || k === "out") {
      holdTimer = setTimeout(() => { holdRepeat = setInterval(() => press(k), 200); }, 450);
    }
  });
  const release = () => {
    stopHold();
    kbd.querySelectorAll(".key.pressed").forEach((b) => b.classList.remove("pressed"));
  };
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => kbd.addEventListener(ev, release));
  kbd.addEventListener("contextmenu", (e) => e.preventDefault());

  ["touchend", "click"].forEach((ev) => window.addEventListener(ev, () => {
    if (typeof Sound !== "undefined") Sound.init();
  }, { passive: true, capture: true }));

  function measure() {
    const dock = Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top));
    const labelTop = Math.round(tools.getBoundingClientRect().bottom + 8);
    root.style.setProperty("--dock-h", `${dock}px`);
    root.style.setProperty("--label-top", `${labelTop}px`);
    root.style.setProperty("--stage-top", `${labelTop + 92}px`);
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const hidden = document.body.classList.toggle("kbd-collapsed");
    toggle.textContent = hidden ? "▴" : "▾";
    toggle.setAttribute("aria-label", hidden ? "Show keyboard" : "Hide keyboard");
    requestAnimationFrame(() => {
      measure();
      window.dispatchEvent(new Event("resize"));
    });
  });

  measure();
  window.addEventListener("resize", measure);
})();
