// Piece Lab page: renders what /api/data serves (the working tree's packed drawings) and re-renders
// when the server reports a change.

const ORDER = ["K", "Q", "R", "B", "N", "P"];
const ROLE = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
const HEIGHT_LABELS = { ladder: "Ladder", uniform: "Uniform" };
const POSITIONS = {
  middlegame: ["Middlegame", "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP1B1PPP/R2QKB1R"],
  start: ["Start", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"],
  lineup: ["Lineup", "8/8/8/2kqrbnp/2KQRBNP/8/8/8"]
};
const STORE = "piece-lab";

const $ = (selector) => document.querySelector(selector);
const capital = (s) => s[0].toUpperCase() + s.slice(1);

let data;
const SQUARE = 96;
const state = {
  set: "cburnett",
  theme: "brown",
  pos: "middlegame",
  open: { board: true, measure: false }
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE) ?? "{}"));
} catch {
  // Private window or blocked storage: start from the defaults.
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // Not persisted; the page still works.
  }
}

/* ---------------------------------------------------------------- drawing helpers */

const pieceUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const drawings = (heights, set = state.set) => data.working[heights][set];

function pieceEl(svgs, code) {
  const el = document.createElement("piece");
  el.className = `${code[0] === "w" ? "white" : "black"} ${ROLE[code[1]]}`;
  el.style.backgroundImage = pieceUrl(svgs[code]);
  return el;
}

function square(dark, code, svgs) {
  const sq = document.createElement("div");
  sq.className = dark ? "sq d" : "sq";
  if (code) sq.append(pieceEl(svgs, code));
  return sq;
}

/* ---------------------------------------------------------------- measuring */

// Rasterise as the board does (background-size: cover from the top-left) and find the ink.
const measured = new Map();
async function measure(svg) {
  if (measured.has(svg)) return measured.get(svg);
  const S = 400;
  const vb = svg
    .match(/^<svg[^>]* viewBox="([^"]+)"/)?.[1]
    .split(/[\s,]+/)
    .map(Number);
  const [w, h] = vb ? [vb[2], vb[3]] : [S, S];
  const scale = Math.max(S / w, S / h);
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(
    svg.replace(/^<svg/, `<svg width="${w * scale}" height="${h * scale}"`)
  )}`;
  let m;
  try {
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: S, height: S });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w * scale, h * scale);
    const px = ctx.getImageData(0, 0, S, S).data;
    let top = S,
      bottom = -1,
      left = S,
      right = -1;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (px[i + 3] <= 24) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    const pct = (v) => (v / S) * 100;
    m = {
      top: pct(top),
      foot: pct(S - 1 - bottom),
      left: pct(left),
      h: pct(bottom - top + 1),
      w: pct(right - left + 1),
      dx: pct((left + right) / 2 - S / 2),
      clipped: top <= 0 || left <= 0 || bottom >= S - 1 || right >= S - 1
    };
  } catch {
    m = { broken: true, top: 0, foot: 0, left: 0, h: 0, w: 0, dx: 0 };
  }
  measured.set(svg, m);
  return m;
}

async function measureSet(svgs) {
  const out = {};
  for (const code of Object.keys(svgs)) out[code] = await measure(svgs[code]);
  return out;
}

const f1 = (n) => n.toFixed(1);
const swatch = (hex) => `<span class="swatch" style="--c:${hex}" title="${hex}"></span>`;

/** Every colour a set paints with (fills, strokes, gradient stops), darkest first. */
function palette(svgs) {
  const colours = new Set();
  for (const svg of Object.values(svgs)) {
    for (const m of svg.matchAll(/(?:fill|stroke|stop-color)\s*(?:=\s*"|:\s*)(#[0-9a-fA-F]{6})/g)) {
      colours.add(m[1].toLowerCase());
    }
  }
  const tone = (hex) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
  return [...colours].sort((a, b) => tone(a) - tone(b));
}

/* ---------------------------------------------------------------- pickers */

/** A button that opens a listbox of options with previews. Arrow keys move, Enter picks, Esc closes. */
function picker(host, { label, options, value, onChange }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "picker-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", `${label}: ${current.label}`);
  button.append(
    current.preview(),
    Object.assign(document.createElement("span"), { textContent: current.label })
  );
  button.insertAdjacentHTML("beforeend", '<span class="chev" aria-hidden="true">▼</span>');
  const list = document.createElement("ul");
  list.className = "picker-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  list.tabIndex = -1;
  list.hidden = true;
  for (const o of options) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(o.value === current.value));
    li.append(o.preview(), Object.assign(document.createElement("span"), { textContent: o.label }));
    list.append(li);
  }
  host.replaceChildren(button, list);

  const items = [...list.children];
  let active = options.indexOf(current);
  const highlight = (i) => {
    active = (i + items.length) % items.length;
    items.forEach((li, n) => li.classList.toggle("active", n === active));
    items[active].scrollIntoView({ block: "nearest" });
  };
  const outside = (e) => {
    if (!host.contains(e.target)) close();
  };
  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside);
  }
  const open = () => {
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    highlight(options.indexOf(current));
    list.focus();
    document.addEventListener("pointerdown", outside);
  };
  const pick = (i) => {
    close();
    button.focus();
    if (options[i].value !== current.value) onChange(options[i].value);
  };
  button.addEventListener("click", () => (list.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    open();
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") highlight(active + 1);
    else if (e.key === "ArrowUp") highlight(active - 1);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape") {
      close();
      button.focus();
    } else if (e.key === "Tab") close();
    else return;
    if (e.key !== "Tab") e.preventDefault();
  });
  list.addEventListener("pointermove", (e) => {
    const li = e.target.closest("li");
    if (li) highlight(items.indexOf(li));
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) pick(items.indexOf(li));
  });
}

function setPreview(set) {
  return () => {
    const el = document.createElement("span");
    el.className = "preview set";
    const svgs = drawings(data.heights[0], set);
    el.append(square(false, "wK", svgs), square(true, "bK", svgs));
    return el;
  };
}

function themePreview({ light, dark }) {
  return () => {
    const el = document.createElement("span");
    el.className = "preview theme";
    for (const colour of [light, dark, dark, light]) {
      const sq = document.createElement("span");
      sq.style.background = colour;
      el.append(sq);
    }
    return el;
  };
}

/* ---------------------------------------------------------------- controls */

const SEGMENTS = {
  pos: () => Object.fromEntries(Object.entries(POSITIONS).map(([k, [label]]) => [k, label]))
};

function renderControls() {
  picker($('[data-picker="set"]'), {
    label: "Piece set",
    value: state.set,
    options: data.sets.map((s) => ({ value: s, label: capital(s), preview: setPreview(s) })),
    onChange: (v) => update({ set: v })
  });
  picker($('[data-picker="theme"]'), {
    label: "Board colours",
    value: state.theme,
    options: Object.entries(data.boards).map(([t, colours]) => ({
      value: t,
      label: capital(t),
      preview: themePreview(colours)
    })),
    onChange: (v) => update({ theme: v })
  });
  for (const el of document.querySelectorAll("[data-ctl]")) {
    const key = el.dataset.ctl;
    el.innerHTML = Object.entries(SEGMENTS[key]())
      .map(
        ([v, l]) =>
          `<button type="button" data-v="${v}" aria-pressed="${v === state[key]}">${l}</button>`
      )
      .join("");
  }
  for (const el of document.querySelectorAll("[data-open]")) el.open = state.open[el.dataset.open];
  const { light, dark } = data.boards[state.theme];
  document.documentElement.style.setProperty("--sq-light", light);
  document.documentElement.style.setProperty("--sq-dark", dark);
}

/** Only speaks up when the app's packed file no longer matches what the generator produces. */
function renderStatus() {
  const el = $("#status");
  el.hidden = !data.stale;
  el.innerHTML = data.stale
    ? "The app's packed pieces are out of date. Run <code>pnpm generate:piece-css</code>"
    : "";
}

/* ---------------------------------------------------------------- boards */

const heightLabel = (heights) => HEIGHT_LABELS[heights] ?? capital(heights);

/** One board per piece size mode, side by side, so the two read against each other. */
function renderBoards() {
  const [, fen] = POSITIONS[state.pos];
  if (!state.open.board) return;
  $("#boards").replaceChildren(
    ...data.heights.map((heights) => {
      const svgs = drawings(heights);
      const board = document.createElement("div");
      board.className = "board";
      board.style.setProperty("--board", `${SQUARE * 8}px`);
      fen.split("/").forEach((rank, r) => {
        let f = 0;
        for (const ch of rank) {
          const empty = /\d/.test(ch);
          for (let i = 0; i < (empty ? Number(ch) : 1); i++, f++) {
            const code = empty ? null : (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
            const sq = square((r + f) % 2 === 1, code, svgs);
            if ((r === 5 || r === 6) && f === 4) sq.classList.add("lm");
            if (f === 0)
              sq.insertAdjacentHTML("beforeend", `<span class="coord r">${8 - r}</span>`);
            if (r === 7)
              sq.insertAdjacentHTML("beforeend", `<span class="coord f">${"abcdefgh"[f]}</span>`);
            board.append(sq);
          }
        }
      });
      const figure = document.createElement("figure");
      figure.innerHTML = `<figcaption>${heightLabel(heights)}</figcaption>`;
      figure.append(board);
      return figure;
    })
  );
}

/* ---------------------------------------------------------------- measurements */

/** The set's twelve pieces in one size mode, each with its ink box, the floor and crown, and its numbers. */
async function pieceMetrics(heights) {
  const svgs = drawings(heights);
  const m = await measureSet(svgs);
  const floor = 100 - m.wP.foot;
  const crown = m.wK.top;
  const grid = document.createElement("div");
  grid.className = "metric-grid";
  for (const colour of ["w", "b"]) {
    ORDER.forEach((kind, i) => {
      const code = colour + kind;
      const g = m[code];
      const partner = m[(colour === "w" ? "b" : "w") + kind];
      const flags = [];
      if (g.broken) flags.push('<span class="flag">Doesn\'t render</span>');
      else if (g.clipped) flags.push('<span class="flag">Touches the edge</span>');
      if (!g.broken && Math.abs(100 - g.foot - floor) > 1.5) {
        flags.push('<span class="flag warn">Off the floor</span>');
      }
      if (colour === "b" && Math.abs(g.h - partner.h) > 0.6) {
        flags.push('<span class="flag warn">Not the white height</span>');
      }
      const card = document.createElement("div");
      card.className = "metric";
      const sq = square((i + (colour === "b" ? 1 : 0)) % 2 === 1, code, svgs);
      sq.insertAdjacentHTML(
        "beforeend",
        `<div class="ink" style="top:${g.top}%;left:${g.left}%;width:${g.w}%;height:${g.h}%"></div>` +
          `<div class="rule" style="top:${floor}%"></div><div class="rule" style="top:${crown}%"></div>`
      );
      card.append(sq);
      card.insertAdjacentHTML(
        "beforeend",
        `<dl><dt>Height</dt><dd>${f1(g.h)}</dd><dt>Width</dt><dd>${f1(g.w)}</dd>` +
          `<dt>Under</dt><dd>${f1(g.foot)}</dd><dt>Off centre</dt><dd>${f1(g.dx)}</dd></dl>${flags.join("")}`
      );
      grid.append(card);
    });
  }
  const figure = document.createElement("figure");
  figure.innerHTML = `<figcaption>${heightLabel(heights)}</figcaption>`;
  figure.append(grid);
  return figure;
}

/** One row per set: each piece's height in both modes, how they sit, and anything broken. */
async function renderSetMetrics() {
  const body = [];
  for (const set of data.sets) {
    const modes = [];
    for (const heights of data.heights) modes.push(await measureSet(drawings(heights, set)));
    const all = modes.flatMap((mode) => Object.values(mode));
    const ok = all.filter((g) => !g.broken);
    const feet = ok.map((g) => g.foot);
    const problems = all.filter((g) => g.broken || g.clipped).length;

    body.push(
      `<tr class="${set === state.set ? "on" : ""}"><td>${capital(set)}</td>` +
        modes
          .map((mode) =>
            ORDER.map(
              (k, i) => `<td${i === 0 ? ' class="start"' : ""}>${f1(mode[`w${k}`].h)}</td>`
            ).join("")
          )
          .join("") +
        `<td class="start">${f1(Math.min(...feet))}–${f1(Math.max(...feet))}</td>` +
        `<td>${f1(Math.max(...ok.map((g) => g.w)))}</td>` +
        `<td class="start palette">${palette(drawings(data.heights[0], set)).map(swatch).join("")}</td>` +
        `<td class="start">${problems || "None"}</td></tr>`
    );
  }
  const groups = data.heights
    .map(
      (heights) => `<th colspan="${ORDER.length}" class="start">${heightLabel(heights)} height</th>`
    )
    .join("");
  const kinds = data.heights
    .map(() => ORDER.map((k, i) => `<th${i === 0 ? ' class="start"' : ""}>${k}</th>`).join(""))
    .join("");
  $("#sets-metrics").innerHTML =
    `<table class="sets-table"><caption>Every set</caption>` +
    `<thead><tr><th></th>${groups}<th colspan="2" class="start"></th><th colspan="2" class="start"></th></tr>` +
    `<tr><th>Set</th>${kinds}<th class="start">Under</th><th>Widest</th><th class="start">Palette</th><th class="start">Problems</th></tr></thead>` +
    `<tbody>${body.join("")}</tbody></table>`;
}

async function renderMeasurements() {
  if (!state.open.measure) return;
  const figures = [];
  for (const heights of data.heights) figures.push(await pieceMetrics(heights));
  $("#pieces-metrics").replaceChildren(...figures);
  await renderSetMetrics();
}

/* ---------------------------------------------------------------- wiring */

async function render() {
  renderControls();
  renderStatus();
  renderBoards();
  await renderMeasurements();
}

function update(patch) {
  Object.assign(state, patch);
  save();
  render().catch(fail);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ctl] button");
  if (b) update({ [b.parentElement.dataset.ctl]: b.dataset.v });
});
for (const el of document.querySelectorAll("[data-open]")) {
  el.addEventListener("toggle", () => {
    const key = el.dataset.open;
    if (state.open[key] === el.open) return;
    state.open[key] = el.open;
    save();
    if (key === "board") renderBoards();
    else renderMeasurements().catch(fail);
  });
}

async function load() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error(await res.text());
  data = await res.json();
  if (!data.sets.includes(state.set)) state.set = data.sets[0];
  if (!data.boards[state.theme]) state.theme = Object.keys(data.boards)[0];
  if (!POSITIONS[state.pos]) state.pos = "middlegame";
  state.open = { board: true, measure: false, ...state.open };
  await render();
}

function fail(error) {
  const el = $("#status");
  el.hidden = false;
  el.textContent = `Couldn't load the pieces: ${error.message}`;
}

new EventSource("/api/events").addEventListener("message", (e) => {
  if (e.data === "page") location.reload();
  else load().catch(fail);
});
load().catch(fail);
