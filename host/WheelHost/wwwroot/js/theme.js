// Dark/light theme: persisted in localStorage, defaults to the device's system preference.
const STORAGE_KEY = "wheelControllerTheme.v1";

function systemPrefersLight() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
}

function currentTheme() {
  return localStorage.getItem(STORAGE_KEY) || (systemPrefersLight() ? "light" : "dark");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f2f3f8" : "#0a0b0f");
}

export function initTheme(toggleBtn) {
  let theme = currentTheme();
  applyTheme(theme);
  updateButton();

  toggleBtn.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    updateButton();
  });

  function updateButton() {
    toggleBtn.textContent = theme === "light" ? "🌙" : "☀️";
  }
}
