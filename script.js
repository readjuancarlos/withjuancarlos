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

// Newsletter signup: posts to /api/subscribe (the Kit API key stays on the server).
document.querySelectorAll(".signup-form").forEach((form) => {
  const status = form.querySelector(".signup-form__status");
  const button = form.querySelector("button[type='submit']");

  const show = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();

    if (!email || !form.querySelector("input[name='email']").checkValidity()) {
      show("Please enter a valid email address.", "error");
      form.querySelector("input[name='email']").focus();
      return;
    }

    button.disabled = true;
    show("Subscribing…", "pending");

    try {
      const response = await fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          first_name: String(data.get("first_name") || "").trim(),
          website: String(data.get("website") || ""),
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        form.reset();
        show(
          "Almost done. If this is your first time, check your inbox for a confirmation email.",
          "success"
        );
      } else {
        show(result.error || "Something went wrong. Please try again.", "error");
      }
    } catch {
      show("Couldn’t reach the server. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
});
