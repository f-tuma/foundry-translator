/* Shared preference with the TanStack studio, applied before first paint. */
(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    let theme = "dark";
    try {
      const stored = localStorage.getItem("ember.community.theme.v1");
      if (["dark", "light", "system"].includes(stored)) theme = stored;
    } catch {}
    document.documentElement.dataset.theme =
      theme === "system" ? (media.matches ? "dark" : "light") : theme;
  };
  apply();
  media.addEventListener("change", apply);
  addEventListener("storage", apply);
})();
