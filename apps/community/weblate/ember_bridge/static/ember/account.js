/* Account-only UI adapters. Authentication stays in native Weblate views/widgets.
 * POST-link and WebAuthn completion conventions adapted from Weblate's
 * loader-bootstrap.js, GPL-3.0-or-later, Weblate contributors.
 */
document.addEventListener("DOMContentLoaded", () => {
  const submit = (href, params = {}) => {
    const form = document.getElementById("link-post");
    const url = new URL(href, location.href);
    if (!form || url.origin !== location.origin) return;
    form
      .querySelectorAll("[data-ember-param]")
      .forEach((field) => field.remove());
    form.action = url.href;
    for (const [name, value] of Object.entries(params)) {
      if (name === "csrfmiddlewaretoken") continue;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      input.dataset.emberParam = "";
      form.appendChild(input);
    }
    form.requestSubmit();
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest(".link-post");
    if (link) {
      event.preventDefault();
      submit(
        link.dataset.href,
        link.dataset.params ? JSON.parse(link.dataset.params) : {},
      );
    }
    const copy = event.target.closest("[data-clipboard-value]");
    if (copy) {
      event.preventDefault();
      const status = document.getElementById("ember-copy-status");
      navigator.clipboard.writeText(copy.dataset.clipboardValue).then(
        () => {
          status.textContent =
            copy.dataset.clipboardMessage || "Zkopírováno do schránky.";
        },
        () => {
          status.textContent =
            "Kopírování se nezdařilo. Označte a zkopírujte text ručně.";
        },
      );
    }
  });
  document.addEventListener("otp_webauthn.register_complete", (event) => {
    const input = document.querySelector("input[name=passkey-device-name]");
    if (!input) return;
    submit(
      input.dataset.href.replace("000000", encodeURIComponent(event.detail.id)),
      { name: input.value },
    );
  });
  document.querySelectorAll(".link-auto").forEach((link) => link.click());
});
