const CONFIG = {
  apiBase: "https://books.asherpayn.uk",
  // Replace with the site key from the Turnstile widget you create in the
  // Cloudflare dashboard (see top-level README). This one is public, unlike
  // the secret key which only ever lives on the Worker.
  turnstileSiteKey: "0x4AAAAAAEC2Bg1szMrmazw_",
};

const $ = (id) => document.getElementById(id);

const scanView = $("scan-view");
const resultView = $("result-view");
const addView = $("add-view");

let turnstileWidgetId = null;
let currentLookup = null; // { isbn, title, author, coverUrl }
let activeStopFn = null; // stops whichever scan method is currently running

function showView(view) {
  for (const el of [scanView, resultView, addView]) {
    el.hidden = el !== view;
  }
}

function setScanStatus(text) {
  $("scan-status").textContent = text;
}

// --- Barcode scanning ---------------------------------------------------
//
// Two implementations, in preference order:
//
// 1. The browser's native `BarcodeDetector` API — hardware-accelerated
//    (backed by the OS's own barcode detection, e.g. Android's ML Kit /
//    Apple's Vision framework), which is why apps like OpenReads feel
//    instant. Supported in Chrome/Android and Safari/iOS 17.4+.
// 2. `html5-qrcode`, a pure-JS decoder, as a fallback for browsers without
//    native support (e.g. desktop Firefox). It's noticeably slower because
//    it's decoding frames in JS at a fixed 10fps rather than using
//    hardware acceleration.

async function nativeBarcodeDetectionSupported() {
  if (!("BarcodeDetector" in window)) return false;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes("ean_13");
  } catch {
    return false;
  }
}

async function startScan() {
  $("start-scan-btn").hidden = true;
  setScanStatus("Starting camera...");

  if (await nativeBarcodeDetectionSupported()) {
    await startNativeScan();
  } else {
    await startHtml5Scan();
  }
}

function stopScan() {
  activeStopFn?.();
  activeStopFn = null;
  $("start-scan-btn").hidden = false;
  $("stop-scan-btn").hidden = true;
  setScanStatus("");
}

async function startNativeScan() {
  const container = $("qr-reader");
  container.innerHTML = "";
  const video = document.createElement("video");
  video.setAttribute("playsinline", ""); // required for inline (non-fullscreen) playback on iOS
  video.muted = true;
  container.appendChild(video);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (err) {
    setScanStatus(`Camera unavailable (${err}). Use manual entry below.`);
    $("start-scan-btn").hidden = false;
    return;
  }
  video.srcObject = stream;
  await video.play();

  const detector = new BarcodeDetector({ formats: ["ean_13"] });
  let running = true;
  activeStopFn = () => {
    running = false;
    stream.getTracks().forEach((track) => track.stop());
    container.innerHTML = "";
  };

  $("stop-scan-btn").hidden = false;
  setScanStatus("Point the camera at the barcode.");

  const scanFrame = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        const isbn = codes[0].rawValue;
        stopScan();
        handleIsbn(isbn);
        return;
      }
    } catch {
      // Transient per-frame errors are expected (e.g. mid-focus-hunt) —
      // just keep trying on the next frame.
    }
    if (running) requestAnimationFrame(scanFrame);
  };
  requestAnimationFrame(scanFrame);
}

async function startHtml5Scan() {
  const html5QrCode = new Html5Qrcode("qr-reader");
  const config = {
    fps: 10,
    qrbox: { width: 250, height: 150 },
    // ISBN barcodes are EAN-13. Restricting to this format makes decoding
    // faster and avoids false positives from unrelated QR codes.
    formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
  };

  activeStopFn = () => {
    html5QrCode.stop().catch(() => {});
  };

  try {
    await html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
      stopScan();
      handleIsbn(decodedText);
    }, () => {
      // Called continuously while no barcode is found — nothing to do.
    });
    $("stop-scan-btn").hidden = false;
    setScanStatus("Point the camera at the barcode.");
  } catch (err) {
    setScanStatus(`Camera unavailable (${err}). Use manual entry below.`);
    $("start-scan-btn").hidden = false;
  }
}

$("start-scan-btn").addEventListener("click", startScan);
$("stop-scan-btn").addEventListener("click", stopScan);

$("manual-isbn-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const isbn = $("manual-isbn-input").value.trim();
  if (isbn) handleIsbn(isbn);
});

// --- Open Library lookup ----------------------------------------------

async function fetchOpenLibraryData(isbn) {
  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data[`ISBN:${isbn}`];
    return raw ? mapOpenLibraryBook(raw) : null;
  } catch {
    return null;
  }
}

/**
 * TODO (yours to write): map an Open Library `jscmd=data` record for one
 * ISBN into `{ title, author, coverUrl }`.
 *
 * A raw record looks roughly like:
 *   {
 *     title: "The Hobbit",
 *     authors: [{ name: "J.R.R. Tolkien", url: "..." }],
 *     cover: { small: "...", medium: "...", large: "..." }
 *   }
 *
 * Some editions are missing `authors` or `cover` entirely — Open Library's
 * data is user-contributed and inconsistent. Decide how the scan flow
 * should behave in those cases: leave author blank for you to type in,
 * join multiple authors with "&" vs ",", etc — this is a judgment call
 * about the scanning experience, not a fixed answer. (A missing cover is
 * less of a problem now: the add-book form lets you take/upload your own
 * photo, which overrides whatever this function returns — see
 * `add-cover-input` below.)
 */
function mapOpenLibraryBook(raw) {
  // TODO: implement this mapping.
  return { title: "", author: "", coverUrl: "" };
}

// --- Ownership lookup against the Worker -------------------------------

async function lookupOwnership(isbn) {
  const res = await fetch(`${CONFIG.apiBase}/books?isbn=${encodeURIComponent(isbn)}`);
  if (!res.ok) throw new Error(`lookup failed (${res.status})`);
  const { results } = await res.json();
  return results;
}

async function handleIsbn(isbn) {
  setScanStatus("Looking up...");
  isbn = isbn.replace(/[^0-9Xx]/g, "");

  const [openLibraryData, ownership] = await Promise.all([
    fetchOpenLibraryData(isbn),
    lookupOwnership(isbn).catch(() => []),
  ]);

  currentLookup = {
    isbn,
    title: openLibraryData?.title ?? "",
    author: openLibraryData?.author ?? "",
    coverUrl: openLibraryData?.coverUrl ?? "",
  };

  renderResult(ownership);
  showView(resultView);
  setScanStatus("");
}

function renderResult(ownership) {
  const summary = $("book-summary");
  summary.innerHTML = "";
  if (currentLookup.title) {
    const cover = currentLookup.coverUrl
      ? `<img src="${currentLookup.coverUrl}" alt="" height="80">`
      : "";
    summary.innerHTML = `${cover}<strong>${escapeHtml(currentLookup.title)}</strong><br>${escapeHtml(currentLookup.author)}`;
  } else {
    summary.textContent = `ISBN ${currentLookup.isbn} (no cover data found)`;
  }

  const ownedEl = $("owned-result");
  const addBtn = $("add-book-btn");
  if (ownership && ownership.length > 0) {
    ownedEl.className = "status-owned";
    const owners = ownership.map((row) => row.owner_name ?? "Unknown").join(", ");
    ownedEl.textContent = `Already owned — ${owners}`;
    addBtn.hidden = true;
  } else {
    ownedEl.className = "status-missing";
    ownedEl.textContent = "Not owned yet";
    addBtn.hidden = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

$("back-to-scan-btn").addEventListener("click", () => {
  showView(scanView);
});

// --- Add book -----------------------------------------------------------

async function openAddView() {
  $("add-title").value = currentLookup.title;
  $("add-author").value = currentLookup.author;
  $("add-isbn").value = currentLookup.isbn;
  $("add-cover-input").value = "";
  updateCoverPreview(currentLookup.coverUrl);

  await populateOwnerOptions();
  renderTurnstileWidget();

  $("add-status").textContent = "";
  showView(addView);
}

function updateCoverPreview(url) {
  const preview = $("add-cover-preview");
  preview.src = url ?? "";
  preview.hidden = !url;
}

// Downscale + re-encode so a phone photo (often several MB) becomes a
// small enough data URL to store as a plain D1 text column — no R2
// bucket/binding needed for something this size.
function resizeImageToDataUrl(file, maxDimension = 480, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("could not read image"));
    img.src = URL.createObjectURL(file);
  });
}

$("add-cover-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    currentLookup.coverUrl = await resizeImageToDataUrl(file);
    updateCoverPreview(currentLookup.coverUrl);
  } catch {
    $("add-status").textContent = "Could not read that photo — try another.";
  }
});

async function populateOwnerOptions() {
  const select = $("add-owner");
  select.innerHTML = "";
  try {
    const res = await fetch(`${CONFIG.apiBase}/people`);
    const { results } = await res.json();
    for (const person of results) {
      const option = document.createElement("option");
      option.value = person.id;
      option.textContent = person.name;
      select.appendChild(option);
    }
  } catch {
    $("add-status").textContent = "Could not load owner list — check your connection.";
  }
}

function renderTurnstileWidget() {
  const container = $("turnstile-container");
  if (turnstileWidgetId !== null) {
    turnstile.remove(turnstileWidgetId);
  }
  turnstileWidgetId = turnstile.render(container, {
    sitekey: CONFIG.turnstileSiteKey,
  });
}

$("add-book-btn").addEventListener("click", openAddView);
$("cancel-add-btn").addEventListener("click", () => showView(resultView));

$("add-book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = turnstile.getResponse(turnstileWidgetId);
  if (!token) {
    $("add-status").textContent = "Please complete the verification check.";
    return;
  }

  $("add-status").textContent = "Saving...";

  try {
    const res = await fetch(`${CONFIG.apiBase}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isbn: $("add-isbn").value.trim() || null,
        title: $("add-title").value.trim(),
        author: $("add-author").value.trim() || null,
        owner_id: Number($("add-owner").value),
        coverUrl: currentLookup.coverUrl || null,
        turnstileToken: token,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "unknown error" }));
      $("add-status").textContent = `Could not save: ${error}`;
      turnstile.reset(turnstileWidgetId);
      return;
    }

    $("add-status").textContent = "Saved!";
    setTimeout(() => showView(scanView), 800);
  } catch {
    $("add-status").textContent = "Network error — please try again.";
    turnstile.reset(turnstileWidgetId);
  }
});
