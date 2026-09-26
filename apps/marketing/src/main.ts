import "./styles.css";

// Highlight the rail link for the section being read (the rail is only shown on wide screens).
const links = [...document.querySelectorAll<HTMLAnchorElement>(".rail-nav a[data-spy]")];
const sections = links
  .map((link) => document.getElementById(link.dataset.spy ?? ""))
  .filter((section): section is HTMLElement => section !== null);

let current = "";
function update() {
  // The last section whose top has passed the reading line (a third of the way down the viewport).
  const line = window.innerHeight / 3;
  let id = sections[0]?.id ?? "";
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= line) id = section.id;
  }
  // At the very bottom the last sections may never reach the line; mark the last one.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
    id = sections[sections.length - 1]?.id ?? id;
  }
  if (id === current) return;
  current = id;
  for (const link of links) {
    if (link.dataset.spy === id) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

let queued = false;
window.addEventListener(
  "scroll",
  () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  },
  { passive: true }
);
window.addEventListener("resize", update);
update();
