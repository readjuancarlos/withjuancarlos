const toggle = document.querySelector(".nav-toggle");
const mobileNav = document.querySelector("#mobile-nav");

if (toggle && mobileNav) {
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    mobileNav.hidden = !open;
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  mobileNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
}

const revealEls = [
  ...document.querySelectorAll(".highlight, .section, .join"),
  ...document.querySelectorAll(".pillar"),
];

if ("IntersectionObserver" in window) {
  document.querySelectorAll(".pillar").forEach((el, i) => {
    el.style.setProperty("--delay", `${i * 90}ms`);
  });

  revealEls.forEach((el) => el.classList.add("reveal"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  revealEls.forEach((el) => observer.observe(el));
}
