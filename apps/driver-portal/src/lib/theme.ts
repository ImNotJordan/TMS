const DARK_MODE_KEY = "driver-portal.dark-mode";

export function readDarkModePref(): boolean {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return true;
  }
  try {
    return localStorage.getItem(DARK_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDarkModePref(value: boolean) {
  try {
    localStorage.setItem(DARK_MODE_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

export function applyDarkModeClass(value: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", value);
}
