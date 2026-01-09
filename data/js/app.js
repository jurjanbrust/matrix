// Environment detection for Pixel Matrix FX Control
const BASE_URL_STORAGE_KEY = "pixelMatrixBaseUrl";
const isHttpProtocol = window.location.protocol === "http:" || window.location.protocol === "https:";
const pageHostname = window.location.hostname || "";
const isRunningOnESP = isHttpProtocol && pageHostname && pageHostname !== "127.0.0.1" && pageHostname !== "localhost";
const MARQUEE_MAX_LENGTH = 2048;
window.isRunningOnESP = isRunningOnESP;

function readStoredBaseUrl() {
  try {
    return localStorage.getItem(BASE_URL_STORAGE_KEY) || "";
  } catch (error) {
    console.warn("Base URL storage unavailable", error);
    return "";
  }
}

function determineInitialBaseUrl() {
  const stored = readStoredBaseUrl();
  if (stored) {
    return stored;
  }

  if (isRunningOnESP) {
    // Page is served by the device; use relative paths.
    return "";
  }

  if (isHttpProtocol && pageHostname) {
    return window.location.origin;
  }

  return "http://192.168.10.240";
}

window.baseUrl = determineInitialBaseUrl();
class PixelMatrixApp {
  constructor() {

    this.baseUrlInput = null;
    this.baseUrlHelper = null;
    this.currentPlaybackMode = "sequential";
    this.uiVersion = "—";
    this.supportsEventSource = typeof window.EventSource === "function";
    this.statusSource = null;
    this.statusStreamRetryTimer = null;
    this.statusStreamBackoffMs = 2000;
    this.statusPollTimer = null;
    this.statusMessageResetTimer = null;
    this.lastStatusText = "Disconnected";
    this.lastStatusType = "error";
    this.marqueeTextInput = null;
    this.marqueeCharCountLabel = null;
    this.marqueeSizeInput = null;
    this.marqueeSpeedInput = null;
    this.marqueeColorInput = null;
    this.hasAppliedInitialControls = false;
    console.log("Base URL set to:", window.baseUrl || "(device origin)");

    // Call init AFTER baseUrl is set
    this.currentPlaybackState = null;
    this.init();
  }

  init() {
    console.log("Pixel Matrix FX Control App Initialized");
    this.loadUiVersion();
    this.initializeConnectionControls();
    this.cacheMarqueeControls();
    this.updatePlaybackModeButtons(this.currentPlaybackMode, false);
    this.applyInitialTimezoneSelection();
    this.startStatusUpdates();
  }

  // Update brightness display while sliding
  updateBrightnessDisplay(value) {
    document.getElementById("sliderValue").textContent = value;
  }

  // Set brightness via API
  async setBrightness(value) {
    try {
      this.showLoading("brightnessSlider");

      const response = await fetch(
        window.baseUrl + "/api/brightness/set?value=" + value,
        {
          method: "GET",
        }
      );

      const data = await response.json();

      if (data.status === "success") {
        // Update displays
        document.getElementById("sliderValue").textContent =
          data.new_brightness;

        this.showMessage("Brightness updated successfully!", "success");
        console.log("Brightness set to:", data.new_brightness);
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Brightness request failed:", error);
    } finally {
      this.hideLoading("brightnessSlider");
    }
  }

  // Reset WiFi credentials
  async resetWiFi() {
    if (
      !confirm(
        "Are you sure you want to reset WiFi credentials? Device will restart in config mode."
      )
    ) {
      return;
    }

    try {
      this.showLoading("resetWiFiBtn");

      const response = await fetch(window.baseUrl + "/api/wifi/reset", {
        method: "GET",
      });
      const data = await response.json();

      this.showMessage(
        data.message,
        data.status === "success" ? "success" : "error"
      );

      if (data.status === "success") {
        setTimeout(() => {
          this.showMessage(
            "Device is restarting... You will need to reconnect.",
            "info"
          );
        }, 1000);
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("WiFi reset request failed:", error);
    } finally {
      this.hideLoading("resetWiFiBtn");
    }
  }

  // Restart device
  async restartDevice() {
    if (!confirm("Are you sure you want to restart the device?")) {
      return;
    }

    try {
      this.showLoading("restartBtn");

      const response = await fetch(window.baseUrl + "/api/restart", {
        method: "GET",
      });
      const data = await response.json();

      this.showMessage(
        data.message,
        data.status === "success" ? "success" : "error"
      );

      if (data.status === "success") {
        setTimeout(() => {
          this.showMessage(
            "Device is restarting... Page will reload automatically.",
            "info"
          );
          // Attempt to reload page after restart
          setTimeout(() => {
            window.location.reload();
          }, 10000);
        }, 1000);
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Restart request failed:", error);
    } finally {
      this.hideLoading("restartBtn");
    }
  }

  // Get device status and update UI
  async updateStatus() {
    try {
      const response = await fetch(window.baseUrl + "/api/status", {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.applyStatusPayload(data);
    } catch (error) {
      console.error("Status update failed:", error);
      this.showMessage("Disconnected", "error", true); // Show disconnected if status update fails
    }
  }

  applyStatusPayload(data) {
    if (!data || data.status !== "connected") {
      this.showMessage("Disconnected", "error", true);
      return;
    }

    const ssidElement = document.getElementById("ssid");
    if (ssidElement && data.ssid) {
      ssidElement.textContent = data.ssid;
    }

    const ipElement = document.getElementById("ip");
    if (ipElement && data.ip) {
      ipElement.textContent = data.ip;
    }

    const hostnameElement = document.getElementById("hostname");
    if (hostnameElement) {
      const hostText = data.hostname && data.hostname.length
        ? data.hostname
        : "Not set";
      hostnameElement.textContent = hostText;
    }

    const currentGifElement = document.getElementById("current-gif");
    if (currentGifElement && data.current_gif) {
      currentGifElement.textContent = data.current_gif;
    }

    const sliderElement = document.getElementById("sliderValue");
    if (sliderElement && Object.prototype.hasOwnProperty.call(data, "brightness")) {
      sliderElement.textContent = data.brightness;
    }

    const playbackState = data.playback_state
      ? data.playback_state
      : data.gif_playback_enabled === true || data.gif_playback_enabled === "true"
      ? "batch"
      : "stopped";
    if (typeof data.playback_mode === "string") {
      this.currentPlaybackMode = data.playback_mode.toLowerCase();
    }
    this.updatePlaybackButtons(playbackState);
    this.updatePlaybackModeButtons(this.currentPlaybackMode, playbackState === "batch");
    this.applyInitialControlsFromStatus(data);

    this.showMessage("Connected", "connected", true);
  }

  applyInitialControlsFromStatus(payload) {
    if (this.hasAppliedInitialControls || !payload) {
      return;
    }

    let applied = false;

    if (Object.prototype.hasOwnProperty.call(payload, "marquee_text")) {
      this.setMarqueeInputValue(payload.marquee_text || "");
      applied = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "marquee_delay_ms") ||
        Object.prototype.hasOwnProperty.call(payload, "marquee_size") ||
        Object.prototype.hasOwnProperty.call(payload, "marquee_color565")) {
      this.setMarqueeControlsFromStatus(payload);
      applied = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "timezone")) {
      this.updateTimezoneDisplay(payload.timezone);
      applied = true;
    }

    if (applied) {
      this.hasAppliedInitialControls = true;
    }
  }

  async updatePlaybackMode(mode) {
    try {
      fetch(window.baseUrl + "/api/settings/playback-mode?mode=" + mode, {
        method: "GET",
      })
        .then((response) => response.json())
        .then((data) => console.log("Playback mode updated:", data))
        .catch((error) =>
          console.error("Error updating playback mode:", error)
        );
    } catch (error) {
      console.error("Error updating playback mode:", error);
    }
  }

  // Start periodic status updates
  startStatusUpdates() {
    this.stopStatusStream();
    this.stopStatusPolling();

    if (this.supportsEventSource) {
      this.statusStreamBackoffMs = 2000;
      this.startStatusStream();
    } else {
      this.startStatusPolling();
    }

    this.updateStatus();
  }

  startStatusStream() {
    const eventsUrl = (window.baseUrl || "") + "/events";
    try {
      const source = new EventSource(eventsUrl);
      this.statusSource = source;
      source.onopen = () => {
        console.log("Status stream connected");
        this.statusStreamBackoffMs = 2000;
      };
      const handler = (event) => this.handleStatusEvent(event);
      source.addEventListener("status", handler);
      source.onmessage = handler;
      source.onerror = (event) => {
        console.warn("Status stream error", event);
        this.handleStatusStreamError();
      };
    } catch (error) {
      console.warn("Failed to initialize status stream", error);
      this.handleStatusStreamError();
    }
  }

  handleStatusEvent(event) {
    if (!event || !event.data) {
      return;
    }
    try {
      const payload = JSON.parse(event.data);
      this.applyStatusPayload(payload);
    } catch (error) {
      console.warn("Invalid status payload", error);
    }
  }

  handleStatusStreamError() {
    this.stopStatusStream();
    if (!this.supportsEventSource) {
      this.startStatusPolling();
      return;
    }
    this.showMessage("Realtime stream disconnected, retrying...", "error", true);
    this.scheduleStatusStreamRetry();
  }

  scheduleStatusStreamRetry() {
    if (this.statusStreamRetryTimer) {
      return;
    }
    const delay = Math.min(this.statusStreamBackoffMs, 30000);
    this.statusStreamRetryTimer = setTimeout(() => {
      this.statusStreamRetryTimer = null;
      this.statusStreamBackoffMs = Math.min(this.statusStreamBackoffMs * 2, 30000);
      this.startStatusStream();
    }, delay);
  }

  stopStatusStream() {
    if (this.statusSource) {
      this.statusSource.close();
      this.statusSource = null;
    }
    if (this.statusStreamRetryTimer) {
      clearTimeout(this.statusStreamRetryTimer);
      this.statusStreamRetryTimer = null;
    }
  }

  startStatusPolling() {
    this.stopStatusPolling();
    this.statusPollTimer = setInterval(() => this.updateStatus(), 10000);
  }

  stopStatusPolling() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  async loadUiVersion() {
    try {
      const response = await fetch("version.json", { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const version = data && data.version ? data.version : "";
      if (version) {
        this.uiVersion = version;
        const element = document.getElementById("firmware-version");
        if (element) {
          element.textContent = version;
        }
      }
    } catch (error) {
      console.warn("Unable to load firmware version", error);
    }
  }

  initializeConnectionControls() {
    this.baseUrlInput = document.getElementById("base-url-input");
    this.baseUrlHelper = document.getElementById("base-url-helper");

    if (this.baseUrlInput) {
      const initialValue = window.baseUrl || "";
      this.baseUrlInput.value = initialValue;
      if (!initialValue) {
        const originSuggestion = window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
        this.baseUrlInput.placeholder = isRunningOnESP && originSuggestion
          ? originSuggestion
          : "http://192.168.1.50";
      }

      this.baseUrlInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveBaseUrlFromInput();
        }
      });
    }

    this.updateBaseUrlHelper();
  }

  cacheMarqueeControls() {
    this.marqueeTextInput = document.getElementById("marquee-text-input");
    this.marqueeCharCountLabel = document.getElementById("marquee-char-count");
    this.marqueeSizeInput = document.getElementById("marquee-size");
    this.marqueeSpeedInput = document.getElementById("marquee-speed");
    this.marqueeColorInput = document.getElementById("marquee-color");

    if (this.marqueeTextInput) {
      this.marqueeTextInput.addEventListener("input", () => this.updateMarqueeCharCount());
      this.updateMarqueeCharCount();
    }

    if (this.marqueeSizeInput) {
      const sizeValue = document.getElementById("marquee-size-value");
      this.marqueeSizeInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) || 1;
        if (sizeValue) sizeValue.textContent = val;
      });
    }

    if (this.marqueeSpeedInput) {
      const initial = parseInt(this.marqueeSpeedInput.value, 10) || 60;
      this.updateMarqueeSpeedLabelFromRaw(initial);
      this.marqueeSpeedInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10) || initial;
        this.updateMarqueeSpeedLabelFromRaw(val);
      });
    }
  }

  computeMarqueeDelay(rawValue) {
    const slider = this.marqueeSpeedInput;
    const min = slider ? parseInt(slider.min, 10) || 10 : 10;
    const max = slider ? parseInt(slider.max, 10) || 200 : 200;
    const clamped = Math.min(Math.max(rawValue, min), max);
    return min + max - clamped; // Invert so right is faster (smaller delay)
  }

  computeMarqueeSliderFromDelay(delayMs) {
    const slider = this.marqueeSpeedInput;
    const min = slider ? parseInt(slider.min, 10) || 10 : 10;
    const max = slider ? parseInt(slider.max, 10) || 200 : 200;
    const clamped = Math.min(Math.max(delayMs, min), max);
    return min + max - clamped; // Reverse mapping for UI position
  }

  updateMarqueeSpeedLabelFromRaw(rawValue) {
    const speedValue = document.getElementById("marquee-speed-value");
    if (!speedValue) return;
    const delayMs = this.computeMarqueeDelay(rawValue);
    speedValue.textContent = delayMs;
  }

  setMarqueeControlsFromStatus(payload) {
    if (!payload) return;

    if (this.marqueeSizeInput && typeof payload.marquee_size !== "undefined") {
      const sizeVal = parseInt(payload.marquee_size, 10) || 1;
      this.marqueeSizeInput.value = sizeVal;
      const sizeLabel = document.getElementById("marquee-size-value");
      if (sizeLabel) sizeLabel.textContent = sizeVal;
    }

    if (this.marqueeSpeedInput && typeof payload.marquee_delay_ms !== "undefined") {
      const delayMs = parseInt(payload.marquee_delay_ms, 10);
      if (!Number.isNaN(delayMs)) {
        const raw = this.computeMarqueeSliderFromDelay(delayMs);
        this.marqueeSpeedInput.value = raw;
        this.updateMarqueeSpeedLabelFromRaw(raw);
      }
    }

    if (this.marqueeColorInput && typeof payload.marquee_color565 !== "undefined") {
      const hex = this.convert565ToHex(payload.marquee_color565);
      if (hex) {
        this.marqueeColorInput.value = hex;
      }
    }
  }

  convert565ToHex(color565) {
    const value = parseInt(color565, 10);
    if (Number.isNaN(value)) return null;
    const r = ((value >> 11) & 0x1f) * 255 / 31;
    const g = ((value >> 5) & 0x3f) * 255 / 63;
    const b = (value & 0x1f) * 255 / 31;
    const toHex = (n) => {
      const clamped = Math.min(255, Math.max(0, Math.round(n)));
      return clamped.toString(16).padStart(2, "0");
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  updateMarqueeCharCount(textOverride) {
    if (!this.marqueeCharCountLabel) {
      return;
    }

    const value = typeof textOverride === "string"
      ? textOverride
      : this.marqueeTextInput
      ? this.marqueeTextInput.value
      : "";
    const length = value.length;
    this.marqueeCharCountLabel.textContent = `${length} / ${MARQUEE_MAX_LENGTH} characters`;
  }

  setMarqueeInputValue(text, force = false) {
    if (!this.marqueeTextInput) {
      return;
    }

    const normalized = text || "";
    const input = this.marqueeTextInput;
    const active = document.activeElement === input;
    if (!force && active && input.value.length > 0 && input.value !== normalized) {
      return;
    }

    if (input.value === normalized) {
      this.updateMarqueeCharCount(normalized);
      return;
    }

    input.value = normalized;
    this.updateMarqueeCharCount(normalized);
  }

  updateBaseUrlHelper() {
    if (!this.baseUrlHelper) {
      return;
    }

    if (!window.baseUrl) {
      if (isRunningOnESP) {
        this.baseUrlHelper.textContent = "Requests target the device that serves this page. Enter a URL to control another panel.";
      } else {
        this.baseUrlHelper.textContent = "Enter the device address, for example http://192.168.1.50.";
      }
      return;
    }

    this.baseUrlHelper.textContent = `Requests use ${window.baseUrl}.`;
  }

  saveBaseUrlFromInput() {
    const value = this.baseUrlInput ? this.baseUrlInput.value : "";
    this.setBaseUrl(value);
  }

  persistBaseUrl(value) {
    try {
      if (value) {
        localStorage.setItem(BASE_URL_STORAGE_KEY, value);
      } else {
        localStorage.removeItem(BASE_URL_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to persist base URL", error);
    }
  }

  setBaseUrl(rawValue) {
    const inputValue = (rawValue || "").trim();

    if (!inputValue) {
      if (isRunningOnESP) {
        window.baseUrl = "";
        this.persistBaseUrl("");
        this.updateBaseUrlHelper();
        if (this.baseUrlInput) {
          this.baseUrlInput.value = "";
        }
        console.log("API base URL reset to device origin");
        this.showMessage("Using device-hosted API endpoints", "success");
        this.startStatusUpdates();
        return;
      }

      this.showMessage("Enter the device address, for example http://192.168.1.50", "error");
      return;
    }

    let normalized = inputValue;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `http://${normalized}`;
    }
    normalized = normalized.replace(/\/+$/, "");

    window.baseUrl = normalized;
    this.persistBaseUrl(normalized);
    if (this.baseUrlInput) {
      this.baseUrlInput.value = normalized;
    }

    this.updateBaseUrlHelper();
    console.log("API base URL configured:", normalized);
    this.showMessage(`API base set to ${normalized}`, "success");
    this.startStatusUpdates();
  }

  // Show loading state
  showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add("loading");
      element.disabled = true;
    }
  }

  // Hide loading state
  hideLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove("loading");
      element.disabled = false;
    }
  }

  updatePlaybackModeButtons(mode, isPlaying = false) {
    const sequentialBtn = document.getElementById("play-sequential-btn");
    const randomBtn = document.getElementById("play-random-btn");
    const folderBtn = document.getElementById("play-folder-btn");
    const buttons = [sequentialBtn, randomBtn, folderBtn].filter(Boolean);

    buttons.forEach((btn) => {
      btn.classList.remove("active");
      btn.disabled = false;
    });

    const normalized = (mode || "sequential").toLowerCase();
    let activeButton = null;
    switch (normalized) {
      case "random":
        activeButton = randomBtn;
        break;
      case "folders":
        activeButton = folderBtn;
        break;
      default:
        activeButton = sequentialBtn;
        break;
    }

    if (activeButton) {
      activeButton.classList.add("active");
      if (isPlaying) {
        activeButton.disabled = true;
      }
    }
  }

  // Update playback control buttons so only the active mode is highlighted
  updatePlaybackButtons(playbackState) {
    const playBtn = document.getElementById("play-btn");
    const stopBtn = document.getElementById("stop-btn");
    const clockBtn = document.getElementById("clock-btn");
    const testBtn = document.getElementById("test-btn");
    const lifeBtn = document.getElementById("life-btn");
    const spectrumBtn = document.getElementById("spectrum-btn");
    const marqueeBtn = document.getElementById("marquee-btn");

    const buttons = [playBtn, stopBtn, clockBtn, testBtn, lifeBtn, spectrumBtn, marqueeBtn].filter(Boolean);
    buttons.forEach((btn) => {
      btn.classList.remove("active");
      btn.disabled = false;
    });

    let normalized = (playbackState || "").toLowerCase();
    if (normalized === "single") {
      normalized = "batch";
    }

    let activeButton = null;
    switch (normalized) {
      case "clock":
        activeButton = clockBtn;
        break;
      case "test":
        activeButton = testBtn;
        break;
      case "life":
        activeButton = lifeBtn;
        break;
      case "spectrum":
        activeButton = spectrumBtn;
        break;
      case "marquee":
        activeButton = marqueeBtn;
        break;
      case "stopped":
        activeButton = stopBtn;
        break;
      case "batch":
        activeButton = playBtn;
        break;
      default:
        activeButton = null;
        break;
    }

    if (activeButton) {
      activeButton.classList.add("active");
      activeButton.disabled = true;
    }

    this.currentPlaybackState = normalized || null;
  }

  // Play GIF
  async playGif() {
    try {
      const response = await fetch(window.baseUrl + "/api/gif/play", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("batch");
        this.showMessage(data.message, "success");
        console.log("GIF playback started:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Play GIF request failed:", error);
    }
  }

  // Pause GIF
  async stopGif() {
    try {
      const response = await fetch(window.baseUrl + "/api/gif/stop", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("stopped");
        this.showMessage(data.message, "success");
        console.log("GIF playback stopped:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Stop GIF request failed:", error);
    }
  }

  // Switch to clock display mode
  async showClock() {
    try {
      const response = await fetch(window.baseUrl + "/api/clock/show", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("clock");
        this.showMessage(data.message, "success");
        console.log("Clock mode enabled:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Clock mode request failed:", error);
    }
  }

  // Switch to test pattern mode
  async showTestPattern() {
    try {
      const response = await fetch(window.baseUrl + "/api/test/show", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("test");
        this.showMessage(data.message, "success");
        console.log("Test pattern mode enabled:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Test pattern request failed:", error);
    }
  }

  // Switch to Game of Life mode
  async showGameOfLife() {
    try {
      const response = await fetch(window.baseUrl + "/api/life/show", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("life");
        this.showMessage(data.message, "success");
        console.log("Game of Life mode enabled:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Game of Life request failed:", error);
    }
  }

  // Switch to Spectrum Visualizer mode
  async showSpectrumVisualizer() {
    try {
      const response = await fetch(window.baseUrl + "/api/spectrum/show", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("spectrum");
        this.showMessage(data.message, "success");
        console.log("Spectrum visualizer enabled:", data);
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Spectrum request failed:", error);
    }
  }

  async showMarqueeMode() {
    try {
      const response = await fetch(window.baseUrl + "/api/marquee/show", {
        method: "GET",
      });

      const data = await response.json();

      if (data.status === "success" || data.status === "info") {
        this.updatePlaybackButtons("marquee");
        this.showMessage(data.message, "success");
        await this.updateStatus();
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Marquee request failed:", error);
    }
  }

  async submitMarqueeText() {
    if (!this.marqueeTextInput) {
      return;
    }

    const text = this.marqueeTextInput.value || "";
    const trimmed = text.trim();
    if (!trimmed.length) {
      this.showMessage("Enter marquee text before sending", "error");
      return;
    }

    try {
      this.showLoading("marquee-text-submit");
      const url = `${window.baseUrl}/api/marquee/text?text=${encodeURIComponent(text)}`;
      const response = await fetch(url, { method: "GET" });

      const data = await response.json();

      if (data.status === "success") {
        const updated = data.text || text;
        this.setMarqueeInputValue(updated, true);
        this.showMessage(data.message || "Marquee text updated", "success");
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Marquee text upload failed:", error);
    } finally {
      this.hideLoading("marquee-text-submit");
    }

  }

  async submitMarqueeSettings() {
    if (!this.marqueeSizeInput || !this.marqueeSpeedInput || !this.marqueeColorInput) {
      console.warn("Marquee setting inputs not found");
      return;
    }

    const size = parseInt(this.marqueeSizeInput.value, 10) || 1;
    const speedRaw = parseInt(this.marqueeSpeedInput.value, 10) || 60;
    const speed = this.computeMarqueeDelay(speedRaw);
    const color = (this.marqueeColorInput.value || "#ffffff").replace("#", "");

    const params = new URLSearchParams({
      size: String(size),
      speed: String(speed),
      color,
    });

    try {
      this.showLoading("marquee-settings-submit");
      const response = await fetch(window.baseUrl + "/api/marquee/config?" + params.toString(), { method: "GET" });
      const data = await response.json();
      if (data.status === "success") {
        this.showMessage("Marquee settings applied", "success");
      } else {
        this.showMessage(data.message || "Failed to apply settings", "error");
      }
    } catch (error) {
      console.error("Marquee settings request failed:", error);
      this.showMessage("Request failed: " + error.message, "error");
    } finally {
      this.hideLoading("marquee-settings-submit");
    }
  }


  // Show message to user using the status bar
  showMessage(message, type = "info", isStatusBarUpdate = false) {
    const statusValueElement = document.querySelector(
      ".status-bar .status-value"
    );
    if (statusValueElement) {
      statusValueElement.textContent = message;
      // Remove previous type classes
      statusValueElement.classList.remove(
        "connected",
        "error",
        "success",
        "info"
      );
      // Add the new type class
      statusValueElement.classList.add(type);
      if (isStatusBarUpdate) {
        this.lastStatusText = message;
        this.lastStatusType = type;
        if (this.statusMessageResetTimer) {
          clearTimeout(this.statusMessageResetTimer);
          this.statusMessageResetTimer = null;
        }
        return;
      }

      if (this.statusMessageResetTimer) {
        clearTimeout(this.statusMessageResetTimer);
      }
      this.statusMessageResetTimer = setTimeout(() => {
        this.showMessage(
          this.lastStatusText || "Connected",
          this.lastStatusType || "connected",
          true
        );
      }, 5000);
    }
  }

  async playMode(mode) {
    const normalized = (mode || "sequential").toLowerCase();
    try {
      const result = await this.updatePlaybackMode(normalized);
      if (!result) {
        return;
      }
      this.currentPlaybackMode = normalized;
      this.updatePlaybackModeButtons(normalized, true);
      await this.playGif();
    } catch (error) {
      console.error("Play mode request failed:", error);
    }
  }

  updateTimezoneDisplay(timezone) {
    const input = document.getElementById("timezone-input");
    if (input) {
      input.value = timezone || "";
    }

    const select = document.getElementById("timezone-select");
    if (select) {
      const match = Array.from(select.options).some((opt) => opt.value === timezone);
      select.value = match ? timezone : "custom";
      if (!match && timezone) {
        select.setAttribute("data-current", timezone);
      }
    }
  }

  applyInitialTimezoneSelection() {
    const select = document.getElementById("timezone-select");
    const input = document.getElementById("timezone-input");
    if (!select || !input) return;

    const initial = select.getAttribute("data-current") || input.value || "";
    if (!initial) return;

    this.updateTimezoneDisplay(initial);
  }

  handleTimezoneSelect(value) {
    const input = document.getElementById("timezone-input");
    if (!input) return;

    if (value === "custom") {
      input.focus();
      return;
    }

    input.value = value;
    this.setTimezone(value);
  }

  async setTimezone(value) {
    const trimmed = value ? value.trim() : "";
    if (!trimmed) {
      this.showMessage("Timezone cannot be empty", "error");
      return;
    }

    try {
      this.showLoading("timezone-save-btn");
      const response = await fetch(
        window.baseUrl + "/api/settings/timezone?tz=" + encodeURIComponent(trimmed),
        { method: "GET" }
      );

      const data = await response.json();
      if (data.status === "success") {
        this.showMessage("Timezone updated", "success");
        this.updateTimezoneDisplay(data.timezone);
        const select = document.getElementById("timezone-select");
        if (select) {
          select.setAttribute("data-current", data.timezone);
        }
      } else {
        this.showMessage("Error: " + data.message, "error");
      }
    } catch (error) {
      this.showMessage("Request failed: " + error.message, "error");
      console.error("Timezone update failed:", error);
    } finally {
      this.hideLoading("timezone-save-btn");
    }
  }

  dispose() {
    this.stopStatusStream();
    this.stopStatusPolling();
    if (this.statusMessageResetTimer) {
      clearTimeout(this.statusMessageResetTimer);
      this.statusMessageResetTimer = null;
    }
  }
}

// Global functions for HTML onclick handlers
function updateBrightnessDisplay(value) {
  window.app.updateBrightnessDisplay(value);
}

function setBrightness(value) {
  window.app.setBrightness(value);
}

function resetWiFi() {
  window.app.resetWiFi();
}

function restartDevice() {
  window.app.restartDevice();
}

function playGif() {
  window.app.playGif();
}

function playSequentialMode() {
  window.app.playMode("sequential");
}

function playRandomMode() {
  window.app.playMode("random");
}

function playRandomByFolderMode() {
  window.app.playMode("folders");
}

function stopGif() {
  window.app.stopGif();
}

function showClock() {
  window.app.showClock();
}

function showTestPattern() {
  window.app.showTestPattern();
}

function showGameOfLife() {
  window.app.showGameOfLife();
}

function showSpectrumVisualizer() {
  window.app.showSpectrumVisualizer();
}

function showMarquee() {
  window.app.showMarqueeMode();
}

function submitMarqueeText() {
  window.app.submitMarqueeText();
}

function submitMarqueeSettings() {
  window.app.submitMarqueeSettings();
}

function onTimezoneSelectChange(value) {
  window.app.handleTimezoneSelect(value);
}

function setTimezoneFromInput() {
  const input = document.getElementById("timezone-input");
  const value = input ? input.value : "";
  window.app.setTimezone(value);
}

function saveBaseUrl() {
  window.app.saveBaseUrlFromInput();
}


// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  window.app = new PixelMatrixApp();
});

window.addEventListener("beforeunload", () => {
  if (window.app && typeof window.app.dispose === "function") {
    window.app.dispose();
  }
});
