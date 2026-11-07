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

// Newsletter signup: posts to /api/subscribe (the Kit API key stays server-side).
function initSignupForm(form, onSuccess) {
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
    const emailInput = form.querySelector("input[name='email']");

    if (!email || !emailInput.checkValidity()) {
      show("Please enter a valid email address.", "error");
      emailInput.focus();
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
        show("", "");
        if (onSuccess) {
          onSuccess();
        } else {
          show(
            "Almost there! If this is your first time, check your inbox for a confirmation email and click the link inside to make it official.",
            "success"
          );
        }
      } else {
        show(result.error || "Something went wrong. Please try again.", "error");
      }
    } catch {
      show("Couldn’t reach the server. Please try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  return { reset: () => show("", "") };
}

// Inline forms on the page (homepage block, /updates)
document.querySelectorAll(".signup-form").forEach((form) => initSignupForm(form));

// "Get Updates" modal, opened from the header button on every page.
// Without JS (or without <dialog> support) the link falls back to /updates/.
const openers = document.querySelectorAll("[data-signup-open]");

if (openers.length && typeof HTMLDialogElement === "function") {
  const dialog = document.createElement("dialog");
  dialog.className = "signup-modal";
  dialog.setAttribute("aria-labelledby", "signup-modal-title");
  dialog.innerHTML = `
    <div class="signup-modal__panel">
      <button class="signup-modal__close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>

      <div data-view="form">
        <p class="eyebrow">Our schools, together</p>
        <h2 id="signup-modal-title">Come Along With Us</h2>
        <p class="signup__lede">
          This is our community’s work, and you’re part of it. Come along as I serve, see what we’re building together, and help dream up what’s next for our kids.
        </p>
        <form class="signup-form" action="/api/subscribe" method="post" novalidate>
          <div class="signup-form__field">
            <label for="modal-first-name">First name <span>(optional)</span></label>
            <input id="modal-first-name" name="first_name" type="text" autocomplete="given-name" maxlength="80" />
          </div>
          <div class="signup-form__field">
            <label for="modal-email">Email</label>
            <input id="modal-email" name="email" type="email" autocomplete="email" inputmode="email" required />
          </div>
          <div class="signup__hp" aria-hidden="true">
            <label for="modal-website">Leave this field empty</label>
            <input id="modal-website" name="website" type="text" tabindex="-1" autocomplete="off" />
          </div>
          <button class="btn btn--primary" type="submit">Count Me In</button>
          <p class="signup-form__status" role="status" aria-live="polite"></p>
          <p class="signup-form__fine">
            You’ll get a confirmation email first. Unsubscribe any time. See the
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </form>
      </div>

      <div data-view="done" hidden>
        <div class="signup-modal__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </div>
        <h2 id="signup-modal-done-title">Almost There! Check Your Inbox</h2>
        <p class="signup__lede">
          Thanks for coming along. If this is your first time, a confirmation email is on its way.
          Click the link inside to make it official. Don’t see it? Peek in your spam folder.
        </p>
        <button class="btn btn--primary signup-modal__done" type="button">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const formView = dialog.querySelector("[data-view='form']");
  const doneView = dialog.querySelector("[data-view='done']");
  const form = dialog.querySelector(".signup-form");

  const modalForm = initSignupForm(form, () => {
    formView.hidden = true;
    doneView.hidden = false;
    dialog.setAttribute("aria-labelledby", "signup-modal-done-title");
    dialog.querySelector(".signup-modal__done").focus();
  });

  const openModal = () => {
    formView.hidden = false;
    doneView.hidden = true;
    dialog.setAttribute("aria-labelledby", "signup-modal-title");
    modalForm.reset();
    document.body.style.overflow = "hidden";
    dialog.showModal();
    form.querySelector("input[name='first_name']").focus();
  };

  const closeModal = () => dialog.close();

  dialog.addEventListener("close", () => {
    document.body.style.overflow = "";
  });

  // <dialog> closes on Escape natively; this keeps it reliable across browsers
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  });

  // Click on the backdrop (outside the panel) closes the modal
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeModal();
  });
  dialog.querySelector(".signup-modal__close").addEventListener("click", closeModal);
  dialog.querySelector(".signup-modal__done").addEventListener("click", closeModal);

  openers.forEach((opener) => {
    opener.addEventListener("click", (event) => {
      event.preventDefault();
      openModal();
    });
  });
}
