(function () {
  "use strict";

  var FALLBACK_CRT_IMAGES = [
    "/public/images/crt-retro-slideshow.jpg",
    "/public/images/love-letter-lock.jpg"
  ];
  var crtFocusAnimationFrame = 0;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoDate) {
    var dateObject = new Date(isoDate);

    if (Number.isNaN(dateObject.getTime())) {
      return "Draft";
    }

    return dateObject.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function setStatus(message) {
    var node = document.getElementById("viewerStatus");
    if (node) {
      node.textContent = message;
    }
  }

  function showLoadingScreen() {
    var node = document.getElementById("viewerLoadingScreen");
    if (!node) {
      return;
    }

    node.hidden = false;
    node.classList.remove("is-hidden");
  }

  function hideLoadingScreen() {
    var node = document.getElementById("viewerLoadingScreen");
    if (!node) {
      return;
    }

    node.classList.add("is-hidden");
    window.setTimeout(function () {
      node.hidden = true;
    }, 240);
  }

  function suppressGlobalSiteModalsOnViewer() {
    document.querySelectorAll(".l4u-modal").forEach(function (modalNode) {
      modalNode.classList.remove("is-open");
      modalNode.hidden = true;
    });

    document.body.classList.remove("l4u-lock-scroll");
  }

  function setViewerMode(mode) {
    var letterSection = document.getElementById("viewerLetterSection");
    var crtSection = document.getElementById("viewerCrtSection");
    var isCrt = mode === "crt";

    if (letterSection) {
      letterSection.classList.toggle("hidden", isCrt);
    }

    if (crtSection) {
      crtSection.classList.toggle("hidden", !isCrt);
    }

    document.body.classList.toggle("l4u-viewer-crt-mode", isCrt);
  }

  function safeDecodeUriComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  function coercePageId(rawValue) {
    var value = String(rawValue || "").trim();
    var candidate = value;
    var decoded = "";
    var pageMatch;

    if (!candidate) {
      return "";
    }

    decoded = safeDecodeUriComponent(candidate);
    if (decoded !== candidate) {
      candidate = decoded;
      decoded = safeDecodeUriComponent(candidate);
      if (decoded !== candidate) {
        candidate = decoded;
      }
    }

    candidate = candidate.replace(/^amp;/i, "").trim();

    pageMatch = candidate.match(/(?:^|[^A-Za-z0-9_-])(page_[A-Za-z0-9_-]{4,140})(?:[^A-Za-z0-9_-]|$)/i);
    if (pageMatch && pageMatch[1]) {
      return pageMatch[1];
    }

    candidate = candidate.split(/[?#&\s]/)[0];
    candidate = candidate.replace(/^\/+|\/+$/g, "").trim();

    if (/^[A-Za-z0-9_-]{4,140}$/.test(candidate)) {
      return candidate;
    }

    return "";
  }

  function getPageIdFromSearchParams(searchParams, depth) {
    var directKeys = ["id", "page_id", "pageId", "draftId"];
    var direct = "";
    var directIndex;
    var nestedKeys;
    var keyIndex;

    for (directIndex = 0; directIndex < directKeys.length; directIndex += 1) {
      direct = coercePageId(searchParams && searchParams.get ? searchParams.get(directKeys[directIndex]) : "");
      if (direct) {
        return direct;
      }
    }

    nestedKeys = ["u", "url", "link", "href", "target", "dest", "destination"];

    for (keyIndex = 0; keyIndex < nestedKeys.length; keyIndex += 1) {
      var nestedValue = searchParams && searchParams.get ? searchParams.get(nestedKeys[keyIndex]) : "";
      var nestedId = extractPageIdFromRaw(nestedValue, depth + 1);

      if (nestedId) {
        return nestedId;
      }
    }

    return "";
  }

  function extractPageIdFromRaw(rawValue, depth) {
    var maxDepth = 3;
    var candidate = String(rawValue || "").trim();
    var fromDirect = "";
    var parsed = null;
    var fromPath = "";
    var hash = "";
    var hashParams = null;
    var pathParts = [];
    var decodedPath = "";
    var pseudoQuery = "";
    var pseudoParams = null;
    var looseParams = null;

    if (!candidate || depth > maxDepth) {
      return "";
    }

    try {
      parsed = new URL(candidate, window.location.href);
    } catch (_error) {
      parsed = null;
    }

    if (parsed) {
      fromDirect = getPageIdFromSearchParams(parsed.searchParams, depth);
      if (fromDirect) {
        return fromDirect;
      }

      hash = String(parsed.hash || "").replace(/^#/, "");
      if (hash) {
        try {
          hashParams = new URLSearchParams(hash);
          fromDirect = getPageIdFromSearchParams(hashParams, depth);
          if (fromDirect) {
            return fromDirect;
          }
        } catch (_error) {
          // Ignore malformed hash params.
        }

        fromDirect = coercePageId(hash);
        if (fromDirect) {
          return fromDirect;
        }
      }

      pathParts = String(parsed.pathname || "")
        .split("/")
        .filter(Boolean);

      if (pathParts.length >= 2) {
        var penultimate = pathParts[pathParts.length - 2].toLowerCase();
        var lastPart = String(pathParts[pathParts.length - 1] || "");

        if (penultimate === "viewer" || penultimate === "viewer.html") {
          fromPath = coercePageId(lastPart);
          if (fromPath) {
            return fromPath;
          }
        }
      }

      decodedPath = safeDecodeUriComponent(parsed.pathname || "");
      if (decodedPath.indexOf("?id=") >= 0) {
        pseudoQuery = decodedPath.split("?").slice(1).join("?");
        try {
          pseudoParams = new URLSearchParams(pseudoQuery);
          fromDirect = getPageIdFromSearchParams(pseudoParams, depth);
          if (fromDirect) {
            return fromDirect;
          }
        } catch (_error) {
          // Ignore malformed pseudo-query.
        }
      }
    }

    try {
      looseParams = new URLSearchParams(candidate.replace(/^[?#]/, ""));
      fromDirect = getPageIdFromSearchParams(looseParams, depth);
      if (fromDirect) {
        return fromDirect;
      }
    } catch (_error) {
      // Ignore malformed loose params.
    }

    return coercePageId(candidate);
  }

  function getPageIdFromLocation() {
    return extractPageIdFromRaw(window.location.href, 0);
  }

  function upsertMetaTag(attributeName, attributeValue, content) {
    if (!document.head) {
      return;
    }

    var selector = "meta[" + attributeName + '="' + attributeValue + '"]';
    var node = document.head.querySelector(selector);

    if (!node) {
      node = document.createElement("meta");
      node.setAttribute(attributeName, attributeValue);
      document.head.appendChild(node);
    }

    node.setAttribute("content", String(content || ""));
  }

  function upsertCanonicalLink(href) {
    if (!document.head) {
      return;
    }

    var node = document.head.querySelector('link[rel="canonical"]');
    if (!node) {
      node = document.createElement("link");
      node.setAttribute("rel", "canonical");
      document.head.appendChild(node);
    }

    node.setAttribute("href", String(href || ""));
  }

  function buildCanonicalViewerUrl(pageId) {
    var canonicalUrl = new URL(window.location.href);
    var normalizedId = coercePageId(pageId);
    var normalizedPath = String(canonicalUrl.pathname || "");
    var pathMatch = normalizedPath.match(/^(.*?)(?:\/viewer(?:\.html)?)(?:\/[^/]*)?$/i);
    var viewerBasePath = pathMatch
      ? (String(pathMatch[1] || "") + "/viewer")
      : "/viewer";

    viewerBasePath = viewerBasePath.replace(/\/+/g, "/").replace(/\/$/, "") || "/viewer";

    if (canonicalUrl.protocol === "file:") {
      if (/\/viewer(?:\.html)?\/[^/]+$/i.test(normalizedPath)) {
        normalizedPath = normalizedPath.replace(/\/[^/]+$/i, "");
      }

      canonicalUrl.pathname = normalizedPath || viewerBasePath;
      canonicalUrl.search = "";
      if (normalizedId) {
        canonicalUrl.searchParams.set("id", normalizedId);
      }
      canonicalUrl.hash = "";
      return canonicalUrl.toString();
    }

    canonicalUrl.pathname = normalizedId
      ? (viewerBasePath + "/" + encodeURIComponent(normalizedId))
      : viewerBasePath;
    canonicalUrl.search = "";
    canonicalUrl.hash = "";

    return canonicalUrl.toString();
  }

  function syncViewerLocation(pageId) {
    if (!pageId || !window.history || typeof window.history.replaceState !== "function") {
      return;
    }

    var canonicalUrl = buildCanonicalViewerUrl(pageId);

    try {
      var currentUrl = new URL(window.location.href);
      currentUrl.hash = "";

      if (currentUrl.toString() !== canonicalUrl) {
        window.history.replaceState({}, "", canonicalUrl);
      }
    } catch (_error) {
      // Ignore URL normalization errors and continue rendering.
    }
  }

  function syncViewerShareMeta(pageId, pageTitle) {
    var canonicalUrl = buildCanonicalViewerUrl(pageId);
    var normalizedTitle = String(pageTitle || "").trim();

    upsertCanonicalLink(canonicalUrl);
    upsertMetaTag("property", "og:url", canonicalUrl);
    upsertMetaTag("name", "twitter:url", canonicalUrl);

    if (normalizedTitle) {
      var shareTitle = normalizedTitle + " | Letter4U Viewer";
      upsertMetaTag("property", "og:title", shareTitle);
      upsertMetaTag("name", "twitter:title", shareTitle);
    }
  }

  function extractYouTubeVideoId(rawUrl) {
    var value = String(rawUrl || "").trim();
    if (!value) {
      return "";
    }

    try {
      var parsed = new URL(value);
      var host = String(parsed.hostname || "").toLowerCase();
      var path = String(parsed.pathname || "").replace(/^\/+/, "");

      if (host === "youtu.be") {
        return path.split("/")[0] || "";
      }

      if (host.indexOf("youtube.com") !== -1 || host.indexOf("youtube-nocookie.com") !== -1) {
        var fromQuery = String(parsed.searchParams.get("v") || "").trim();
        if (fromQuery) {
          return fromQuery;
        }

        var parts = path.split("/").filter(Boolean);
        if (parts.length >= 2 && (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live")) {
          return parts[1];
        }
      }
    } catch (_error) {
      return "";
    }

    return "";
  }

  function getCrtImageSources(page) {
    var photos = Array.isArray(page && page.photos) ? page.photos : [];
    var imageSources = photos
      .map(function (photo) {
        return photo && photo.dataUrl ? String(photo.dataUrl).trim() : "";
      })
      .filter(Boolean);

    if (!imageSources.length) {
      return FALLBACK_CRT_IMAGES.slice();
    }

    return imageSources;
  }

  function playWarningTone() {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    var audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch (_error) {
      return;
    }

    var now = audioContext.currentTime;
    var master = audioContext.createGain();
    master.connect(audioContext.destination);

    function scheduleBeep(startAt, frequency, durationSeconds, level) {
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(level, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);

      oscillator.connect(gain);
      gain.connect(master);

      oscillator.start(startAt);
      oscillator.stop(startAt + durationSeconds + 0.02);
    }

    scheduleBeep(now + 0.03, 784, 0.16, 0.08);
    scheduleBeep(now + 0.28, 622, 0.2, 0.09);

    audioContext.resume().catch(function () {
      return;
    });

    window.setTimeout(function () {
      audioContext.close().catch(function () {
        return;
      });
    }, 1200);
  }

  function playCountdownTickTone(secondValue) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    var audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch (_error) {
      return;
    }

    var now = audioContext.currentTime;
    var second = toNumber(secondValue, 1);
    var frequency = 720;

    if (second >= 3) {
      frequency = 620;
    } else if (second === 2) {
      frequency = 760;
    } else if (second <= 1) {
      frequency = 900;
    }

    var oscillator = audioContext.createOscillator();
    var gain = audioContext.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.095, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.16);

    audioContext.resume().catch(function () {
      return;
    });

    window.setTimeout(function () {
      audioContext.close().catch(function () {
        return;
      });
    }, 520);
  }

  function createGlitchCurve(amount) {
    var samples = 32768;
    var curve = new Float32Array(samples);
    var level = Math.max(1, toNumber(amount, 52));
    var index = 0;

    for (index = 0; index < samples; index += 1) {
      var x = (index * 2 / samples) - 1;
      curve[index] = ((3 + level) * x * 18) / (Math.PI + (level * Math.abs(x)));
    }

    return curve;
  }

  function playStaticNoise(durationMs) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    var audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch (_error) {
      return;
    }

    var seconds = Math.max(0.7, toNumber(durationMs, 1200) / 1000);
    var now = audioContext.currentTime;
    var sampleRate = audioContext.sampleRate;
    var frameCount = Math.max(1, Math.floor(sampleRate * seconds));
    var noiseBuffer = audioContext.createBuffer(1, frameCount, sampleRate);
    var data = noiseBuffer.getChannelData(0);
    var index = 0;

    for (index = 0; index < frameCount; index += 1) {
      var white = (Math.random() * 2) - 1;
      var hiss = ((Math.random() * 2) - 1) * (Math.random() < 0.12 ? 1.65 : 0.56);
      var crackle = Math.random() < 0.018 ? (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.65, 1.35) : 0;
      data[index] = Math.max(-1, Math.min(1, (white * 0.55) + (hiss * 0.35) + crackle));
    }

    var source = audioContext.createBufferSource();
    source.buffer = noiseBuffer;

    var highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(520, now);

    var bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1850, now);
    bandpass.Q.setValueAtTime(1.9, now);

    var lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(6800, now);

    var distortion = audioContext.createWaveShaper();
    distortion.curve = createGlitchCurve(64);
    distortion.oversample = "4x";

    var stutterGain = audioContext.createGain();
    stutterGain.gain.setValueAtTime(0.0001, now);

    var master = audioContext.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.06);
    master.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    source.playbackRate.setValueAtTime(randomBetween(0.95, 1.12), now);

    var pulseTime = now;
    while (pulseTime < now + seconds - 0.02) {
      var peak = randomBetween(0.06, 0.24);
      var attackEnd = pulseTime + randomBetween(0.005, 0.018);
      var decayEnd = attackEnd + randomBetween(0.02, 0.075);

      stutterGain.gain.setValueAtTime(0.0001, pulseTime);
      stutterGain.gain.linearRampToValueAtTime(peak, attackEnd);
      stutterGain.gain.exponentialRampToValueAtTime(0.0001, decayEnd);

      pulseTime += randomBetween(0.03, 0.12);
    }

    function scheduleBurst(type, startAt, duration, startFrequency, endFrequency, level) {
      var oscillator = audioContext.createOscillator();
      var burstGain = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, endFrequency), startAt + duration);

      burstGain.gain.setValueAtTime(0.0001, startAt);
      burstGain.gain.exponentialRampToValueAtTime(level, startAt + (duration * 0.24));
      burstGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(burstGain);
      burstGain.connect(master);

      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.015);
    }

    var burstCount = 4 + Math.floor(Math.random() * 4);
    for (index = 0; index < burstCount; index += 1) {
      var burstStart = now + randomBetween(0.05, Math.max(0.12, seconds - 0.16));
      var burstDuration = randomBetween(0.04, 0.1);
      var burstStartFreq = randomBetween(180, 920);
      var burstEndFreq = burstStartFreq + (Math.random() < 0.5 ? -1 : 1) * randomBetween(140, 460);
      var burstLevel = randomBetween(0.03, 0.085);

      scheduleBurst(Math.random() < 0.5 ? "sawtooth" : "square", burstStart, burstDuration, burstStartFreq, burstEndFreq, burstLevel);
    }

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(distortion);
    distortion.connect(stutterGain);
    stutterGain.connect(master);
    master.connect(audioContext.destination);

    source.start(now);
    source.stop(now + seconds + 0.05);

    audioContext.resume().catch(function () {
      return;
    });

    window.setTimeout(function () {
      audioContext.close().catch(function () {
        return;
      });
    }, Math.max(1300, Math.floor((seconds + 0.55) * 1000)));
  }

  function sendYouTubeCommand(commandName, args) {
    var frame = document.getElementById("viewerCrtYoutubeFrame");

    if (!frame || !frame.contentWindow || !commandName) {
      return;
    }

    frame.contentWindow.postMessage(JSON.stringify({
      event: "command",
      func: commandName,
      args: Array.isArray(args) ? args : []
    }), "*");
  }

  function queueYouTubePlaybackAttempts(shouldUnmute, volumeLevel) {
    var unmute = shouldUnmute === true;
    var parsedVolume = Number(volumeLevel);
    var volume = Number.isFinite(parsedVolume)
      ? Math.max(0, Math.min(100, Math.floor(parsedVolume)))
      : 72;
    var retryDelays = [80, 260, 620, 1200];

    retryDelays.forEach(function (delayMs) {
      window.setTimeout(function () {
        sendYouTubeCommand("playVideo");

        if (unmute) {
          sendYouTubeCommand("unMute");
          sendYouTubeCommand("setVolume", [volume]);
          return;
        }

        sendYouTubeCommand("mute");
      }, delayMs);
    });
  }

  function toNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function randomBetween(minValue, maxValue) {
    return minValue + (Math.random() * (maxValue - minValue));
  }

  function mountCrtYouTube(videoId, autoplay, startMuted) {
    var frame = document.getElementById("viewerCrtYoutubeFrame");
    if (!frame) {
      return false;
    }

    var normalizedId = String(videoId || "").trim();
    if (!normalizedId) {
      frame.src = "about:blank";
      return false;
    }

    var params = new URLSearchParams({
      autoplay: autoplay ? "1" : "0",
      controls: "0",
      loop: "1",
      playlist: normalizedId,
      modestbranding: "1",
      rel: "0",
      mute: startMuted ? "1" : "0",
      playsinline: "1",
      iv_load_policy: "3",
      enablejsapi: "1"
    });

    if (window.location && /^https?:/i.test(window.location.protocol)) {
      params.set("origin", window.location.origin);
    }

    frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(normalizedId) + "?" + params.toString();
    return true;
  }

  function startCrtFocusAnimation() {
    var screenNode = document.querySelector(".l4u-crt-screen");

    if (!screenNode) {
      return;
    }

    if (crtFocusAnimationFrame) {
      window.cancelAnimationFrame(crtFocusAnimationFrame);
      crtFocusAnimationFrame = 0;
    }

    function tick() {
      var screenRect = screenNode.getBoundingClientRect();
      var centerX = screenRect.left + (screenRect.width / 2);
      var influenceRange = Math.max(160, screenRect.width * 0.42);
      var cards = screenNode.querySelectorAll(".l4u-crt-polaroid");

      cards.forEach(function (cardNode) {
        var cardRect = cardNode.getBoundingClientRect();
        var cardCenter = cardRect.left + (cardRect.width / 2);
        var distance = Math.abs(cardCenter - centerX);
        var normalized = Math.max(0, 1 - Math.min(1, distance / influenceRange));
        var scale = 1 + (normalized * 0.17);

        cardNode.style.setProperty("--l4u-polaroid-scale", scale.toFixed(3));
        cardNode.style.setProperty("--l4u-polaroid-focus", normalized.toFixed(3));
        cardNode.classList.toggle("is-center", normalized > 0.86);
      });

      crtFocusAnimationFrame = window.requestAnimationFrame(tick);
    }

    crtFocusAnimationFrame = window.requestAnimationFrame(tick);
  }

  function renderRandomCrtMusicNotes() {
    var notesLayer = document.getElementById("viewerCrtMusicNotes");
    var symbols = ["♪", "♫", "♬", "♩", "♭", "♮"];
    var noteCount = 20;
    var index = 0;

    if (!notesLayer) {
      return;
    }

    notesLayer.innerHTML = "";

    for (index = 0; index < noteCount; index += 1) {
      var noteNode = document.createElement("span");
      var symbol = symbols[Math.floor(Math.random() * symbols.length)];
      var startX = randomBetween(49, 64);
      var startY = randomBetween(36, 66);
      var duration = randomBetween(3.8, 8.2);
      var delay = randomBetween(0, 4.8);
      var size = randomBetween(1.15, 2.85);
      var rotateStart = randomBetween(-26, 26);
      var rotateEnd = rotateStart + (Math.random() < 0.5 ? -1 : 1) * randomBetween(80, 240);
      var scaleStart = randomBetween(0.46, 0.92);
      var scaleEnd = randomBetween(1.08, 2.28);
      var peakOpacity = randomBetween(0.62, 0.94);
      var corner = Math.floor(Math.random() * 4);
      var deltaX = 0;
      var deltaY = 0;

      if (corner === 0) {
        deltaX = -randomBetween(38, 72);
        deltaY = -randomBetween(24, 58);
      } else if (corner === 1) {
        deltaX = randomBetween(34, 72);
        deltaY = -randomBetween(24, 58);
      } else if (corner === 2) {
        deltaX = -randomBetween(38, 72);
        deltaY = randomBetween(20, 56);
      } else {
        deltaX = randomBetween(34, 72);
        deltaY = randomBetween(20, 56);
      }

      noteNode.className = "l4u-crt-note";
      noteNode.textContent = symbol;
      noteNode.style.left = startX.toFixed(2) + "vw";
      noteNode.style.top = startY.toFixed(2) + "vh";
      noteNode.style.setProperty("--l4u-note-x", deltaX.toFixed(2) + "vw");
      noteNode.style.setProperty("--l4u-note-y", deltaY.toFixed(2) + "vh");
      noteNode.style.setProperty("--l4u-note-delay", delay.toFixed(2) + "s");
      noteNode.style.setProperty("--l4u-note-duration", duration.toFixed(2) + "s");
      noteNode.style.setProperty("--l4u-note-size", size.toFixed(2) + "rem");
      noteNode.style.setProperty("--l4u-note-rotate-start", rotateStart.toFixed(2) + "deg");
      noteNode.style.setProperty("--l4u-note-rotate-end", rotateEnd.toFixed(2) + "deg");
      noteNode.style.setProperty("--l4u-note-scale-start", scaleStart.toFixed(3));
      noteNode.style.setProperty("--l4u-note-scale-end", scaleEnd.toFixed(3));
      noteNode.style.setProperty("--l4u-note-peak-opacity", peakOpacity.toFixed(3));
      notesLayer.appendChild(noteNode);
    }
  }

  function renderCrtSlides(page) {
    var track = document.getElementById("viewerCrtSlidesTrack");
    if (!track) {
      return;
    }

    var imageSources = getCrtImageSources(page);
    var rolledSources = [];
    var pageTitle = String(page && page.title ? page.title : "CRT Memory Reel").trim() || "CRT Memory Reel";
    var minSlides = Math.max(8, imageSources.length * 2);
    var index = 0;

    for (index = 0; index < minSlides; index += 1) {
      rolledSources.push(imageSources[index % imageSources.length]);
    }

    var slideItems = rolledSources.map(function (src, slideIndex) {
      var tilt = slideIndex % 2 === 0
        ? -2.8 - ((slideIndex % 3) * 0.2)
        : 2.35 + ((slideIndex % 4) * 0.18);

      return "" +
        '<figure class="l4u-crt-polaroid" style="--l4u-polaroid-tilt:' + tilt.toFixed(2) + 'deg;">' +
        '  <img src="' + escapeHtml(src) + '" alt="' + escapeHtml(pageTitle + " photo " + (slideIndex + 1)) + '" loading="lazy" />' +
        '</figure>';
    }).join("");

    track.innerHTML = "" +
      '<div class="l4u-crt-slide-group">' + slideItems + '</div>' +
      '<div class="l4u-crt-slide-group" aria-hidden="true">' + slideItems + '</div>';

    var durationSeconds = Math.max(36, rolledSources.length * 3.6);
    track.style.setProperty("--l4u-slide-duration", durationSeconds + "s");

    window.requestAnimationFrame(function () {
      var firstGroup = track.querySelector(".l4u-crt-slide-group");
      if (!firstGroup) {
        return;
      }

      track.style.setProperty("--l4u-slide-shift", firstGroup.getBoundingClientRect().width + "px");
    });

    var vinyl = document.getElementById("viewerCrtVinyl");
    if (vinyl && imageSources.length) {
      vinyl.style.setProperty("--l4u-vinyl-label-image", 'url("' + imageSources[0].replace(/"/g, "%22") + '")');
    }

    startCrtFocusAnimation();
  }

  function showCrtContent(page) {
    var titleNode = document.getElementById("viewerCrtTitle");
    var dateNode = document.getElementById("viewerCrtDate");
    var warningPanel = document.getElementById("viewerCrtWarning");
    var roomNode = document.querySelector(".l4u-crt-room");
    var volumeGateNode = document.getElementById("viewerCrtVolumeGate");
    var volumeGateButton = document.getElementById("viewerCrtVolumeGateButton");
    var countdownNode = document.getElementById("viewerCrtCountdown");
    var countdownRing = document.getElementById("viewerCrtCountdownRing");
    var audioStatus = document.getElementById("viewerCrtAudioStatus");
    var playbackButton = document.getElementById("viewerCrtPlaybackToggle");
    var staticLayer = document.getElementById("viewerCrtStaticLayer");
    var videoId = extractYouTubeVideoId(page.youtubeUrl);
    var introTimer = 0;
    var countdownTimer = 0;
    var staticStarted = false;
    var bootComplete = false;
    var youtubeMounted = false;
    var musicPermissionPrompted = false;
    var musicPermissionGranted = false;
    var isPlaying = true;

    function requestBackgroundMusicPermission() {
      if (!videoId) {
        return false;
      }

      musicPermissionPrompted = true;

      try {
        return window.confirm("Allow background YouTube music for this page? Tap OK to enable music.");
      } catch (_error) {
        return false;
      }
    }

    function primeBackgroundMusicFromGesture() {
      if (!videoId || !musicPermissionGranted) {
        return;
      }

      youtubeMounted = mountCrtYouTube(videoId, true, true);
      if (!youtubeMounted) {
        return;
      }

      queueYouTubePlaybackAttempts(false, 72);
    }

    function clearIntroTimers() {
      if (introTimer) {
        window.clearTimeout(introTimer);
        introTimer = 0;
      }

      if (countdownTimer) {
        window.cancelAnimationFrame(countdownTimer);
        countdownTimer = 0;
      }
    }

    function setPlayback(playing, skipYouTubeCommand) {
      isPlaying = Boolean(playing);

      if (roomNode) {
        roomNode.classList.toggle("is-paused", !isPlaying);
      }

      if (playbackButton) {
        playbackButton.textContent = isPlaying ? "Pause" : "Play";
        playbackButton.setAttribute("aria-label", isPlaying ? "Pause slideshow and music" : "Play slideshow and music");
      }

      if (skipYouTubeCommand) {
        return;
      }

      if (!videoId || !musicPermissionGranted) {
        return;
      }

      if (isPlaying) {
        if (!youtubeMounted) {
          youtubeMounted = mountCrtYouTube(videoId, true, true);
        }

        if (youtubeMounted) {
          queueYouTubePlaybackAttempts(true, 72);
        }

        return;
      }

      sendYouTubeCommand("pauseVideo");
    }

    function completeBootSequence() {
      bootComplete = true;

      if (roomNode) {
        roomNode.classList.remove("is-booting");
        roomNode.classList.remove("is-intro-obscured");
      }

      if (staticLayer) {
        staticLayer.classList.remove("is-active");
      }

      if (warningPanel) {
        warningPanel.classList.add("is-hidden");
      }

      if (videoId && musicPermissionGranted) {
        if (!youtubeMounted) {
          youtubeMounted = mountCrtYouTube(videoId, true, true);
        }

        if (youtubeMounted) {
          queueYouTubePlaybackAttempts(true, 72);
          if (audioStatus) {
            audioStatus.textContent = "Background YouTube music is now playing.";
          }
        } else if (audioStatus) {
          audioStatus.textContent = "Background music could not be initialized on this browser.";
        }
      } else if (videoId && musicPermissionPrompted && !musicPermissionGranted) {
        mountCrtYouTube("", false);
        youtubeMounted = false;
        if (audioStatus) {
          audioStatus.textContent = "Background music is disabled. Slideshow continues without music.";
        }
      } else {
        mountCrtYouTube("", false);

        if (audioStatus) {
          audioStatus.textContent = "No YouTube link was found. Slideshow playback is running.";
        }
      }

      setPlayback(true, true);
    }

    function beginStaticPhase() {
      if (staticStarted) {
        return;
      }

      staticStarted = true;

      if (countdownRing) {
        countdownRing.style.setProperty("--l4u-count-progress", "1");
      }

      if (audioStatus) {
        audioStatus.textContent = "Injecting glitch static and warming up the CRT tube.";
      }

      if (roomNode) {
        roomNode.classList.add("is-booting");
      }

      if (staticLayer) {
        staticLayer.classList.add("is-active");
      }

      playWarningTone();
      playStaticNoise(1260);

      introTimer = window.setTimeout(function () {
        completeBootSequence();
      }, 1250);
    }

    function runCountdown() {
      var totalMs = 3000;
      var startedAt = 0;
      var announcedSecond = 3;

      if (roomNode) {
        roomNode.classList.add("is-intro-obscured");
      }

      if (warningPanel) {
        warningPanel.classList.remove("is-hidden");
      }

      if (countdownNode) {
        countdownNode.textContent = "3";
      }

      playCountdownTickTone(3);

      if (countdownRing) {
        countdownRing.style.setProperty("--l4u-count-progress", "0");
      }

      function paint(now) {
        if (!startedAt) {
          startedAt = now;
        }

        var elapsed = Math.max(0, now - startedAt);
        var progress = Math.min(1, elapsed / totalMs);
        var remainingSeconds = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));

        if (remainingSeconds > 0 && remainingSeconds !== announcedSecond) {
          announcedSecond = remainingSeconds;
          playCountdownTickTone(remainingSeconds);
        }

        if (countdownNode) {
          countdownNode.textContent = String(remainingSeconds);
        }

        if (countdownRing) {
          countdownRing.style.setProperty("--l4u-count-progress", progress.toFixed(4));
        }

        if (progress >= 1) {
          countdownTimer = 0;
          beginStaticPhase();
          return;
        }

        countdownTimer = window.requestAnimationFrame(paint);
      }

      countdownTimer = window.requestAnimationFrame(paint);
    }

    function activateExperience() {
      if (volumeGateNode) {
        volumeGateNode.classList.add("is-hidden");
      }

      if (roomNode) {
        roomNode.classList.remove("is-gated");
      }

      runCountdown();
    }

    setViewerMode("crt");

    if (titleNode) {
      titleNode.textContent = page.title || "Retro TV Memory Reel";
    }

    if (dateNode) {
      dateNode.textContent = formatDate(page.date || page.createdAt);
    }

    renderCrtSlides(page);
    renderRandomCrtMusicNotes();

    if (audioStatus) {
      audioStatus.textContent = videoId
        ? "Sound on recommended. Initializing countdown and static intro..."
        : "Sound on recommended. Countdown and static intro will begin now.";
    }

    mountCrtYouTube("", false);
    setPlayback(true, true);

    if (warningPanel) {
      warningPanel.classList.add("is-hidden");
    }

    if (roomNode) {
      roomNode.classList.add("is-gated");
      roomNode.classList.remove("is-intro-obscured");
      roomNode.classList.remove("is-booting");
    }

    if (volumeGateNode) {
      volumeGateNode.classList.remove("is-hidden");
    }

    if (playbackButton) {
      playbackButton.onclick = function () {
        if (roomNode && roomNode.classList.contains("is-gated")) {
          return;
        }

        if (!bootComplete) {
          clearIntroTimers();
          beginStaticPhase();
          return;
        }

        setPlayback(!isPlaying, false);
      };
    }

    if (volumeGateButton) {
      volumeGateButton.onclick = function () {
        if (videoId) {
          musicPermissionGranted = requestBackgroundMusicPermission();

          if (musicPermissionGranted) {
            primeBackgroundMusicFromGesture();
            if (audioStatus) {
              audioStatus.textContent = "Music permission granted. Starting CRT intro...";
            }
          } else {
            mountCrtYouTube("", false);
            youtubeMounted = false;
            if (audioStatus) {
              audioStatus.textContent = "Music permission denied. Continuing without background music.";
            }
          }
        }

        activateExperience();
      };
    } else {
      activateExperience();
    }

    window.addEventListener("beforeunload", function () {
      clearIntroTimers();

      if (crtFocusAnimationFrame) {
        window.cancelAnimationFrame(crtFocusAnimationFrame);
        crtFocusAnimationFrame = 0;
      }
    });

    setStatus("CRT page loaded.");
  }

  function showContent(page) {
    setViewerMode("letter");

    var classicCard = document.getElementById("viewerLetterClassicCard");
    var immersiveRoot = document.getElementById("viewerLetterImmersive");
    var unlockPanel = document.getElementById("viewerUnlockPanel");

    document.body.classList.remove("l4u-viewer-letter-immersive");

    if (classicCard) {
      classicCard.classList.remove("hidden");
    }

    if (immersiveRoot) {
      immersiveRoot.classList.add("hidden");
    }

    if (unlockPanel) {
      unlockPanel.classList.add("hidden");
    }

    var titleNode = document.getElementById("viewerTitle");
    var recipientNode = document.getElementById("viewerRecipient");
    var dateNode = document.getElementById("viewerDate");
    var messageNode = document.getElementById("viewerMessage");
    var closingNode = document.getElementById("viewerClosing");
    var signatureNode = document.getElementById("viewerSignature");
    var photosNode = document.getElementById("viewerPhotoGrid");
    var contentNode = document.getElementById("viewerContent");

    if (titleNode) {
      titleNode.textContent = page.title || "Untitled Letter";
    }

    if (recipientNode) {
      recipientNode.textContent = page.recipient ? "Dear " + page.recipient + "," : "Dear recipient,";
    }

    if (dateNode) {
      dateNode.textContent = formatDate(page.date || page.createdAt);
    }

    if (messageNode) {
      messageNode.textContent = page.message || "No letter content available.";
    }

    if (closingNode) {
      closingNode.textContent = page.closing || "With love,";
    }

    if (signatureNode) {
      signatureNode.textContent = page.signature || "Your Name";
    }

    if (photosNode) {
      var photos = Array.isArray(page.photos) ? page.photos : [];
      var withPreview = photos.filter(function (photo) {
        return photo && photo.dataUrl;
      });

      photosNode.innerHTML = withPreview.map(function (photo) {
        return '<div class="l4u-photo-thumb"><img alt="Letter photo" src="' + escapeHtml(photo.dataUrl) + '" /></div>';
      }).join("");
    }

    if (contentNode) {
      contentNode.classList.remove("hidden");
    }

    setStatus("Page loaded.");
  }

  function playLetterWarningTone(mode) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    var audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch (_error) {
      return;
    }

    var now = audioContext.currentTime;
    var output = audioContext.createGain();
    output.connect(audioContext.destination);

    function chirp(startAt, type, fromFrequency, toFrequency, duration, level) {
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(fromFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, toFrequency), startAt + duration);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(level, startAt + (duration * 0.32));
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(gain);
      gain.connect(output);

      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    }

    if (mode === "error") {
      chirp(now + 0.01, "square", 340, 180, 0.14, 0.13);
      chirp(now + 0.18, "square", 320, 170, 0.16, 0.12);
    } else if (mode === "unlock") {
      chirp(now + 0.01, "triangle", 300, 620, 0.17, 0.1);
      chirp(now + 0.2, "triangle", 460, 940, 0.2, 0.09);
    } else {
      chirp(now + 0.02, "sine", 520, 690, 0.14, 0.085);
    }

    audioContext.resume().catch(function () {
      return;
    });

    window.setTimeout(function () {
      audioContext.close().catch(function () {
        return;
      });
    }, 900);
  }

  function playLetterActionTone(mode, directionHint) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    var audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch (_error) {
      return;
    }

    var now = audioContext.currentTime;
    var output = audioContext.createGain();
    output.connect(audioContext.destination);

    function pulse(type, offset, duration, fromFrequency, toFrequency, level) {
      var startAt = now + offset;
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(50, fromFrequency), startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(50, toFrequency), startAt + duration);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(level, startAt + Math.max(0.008, duration * 0.24));
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(gain);
      gain.connect(output);

      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    }

    if (mode === "dial") {
      pulse("triangle", 0.0, 0.06, 1880, 1180, 0.062);
      pulse("square", 0.008, 0.05, 1460, 920, 0.05);
    } else if (mode === "pin-correct") {
      pulse("triangle", 0.004, 0.14, 360, 680, 0.1);
      pulse("sine", 0.16, 0.2, 700, 1280, 0.092);
    } else if (mode === "pin-wrong") {
      pulse("square", 0.006, 0.12, 300, 150, 0.12);
      pulse("sawtooth", 0.16, 0.14, 240, 120, 0.086);
    } else if (mode === "typing") {
      pulse("square", 0.0, 0.026, 1560, 1040, 0.031);
    } else if (mode === "swipe") {
      var fromFrequency = directionHint >= 0 ? 980 : 760;
      var toFrequency = directionHint >= 0 ? 210 : 190;
      pulse("sawtooth", 0.0, 0.16, fromFrequency, toFrequency, 0.052);
      pulse("triangle", 0.024, 0.14, fromFrequency * 0.66, toFrequency * 0.9, 0.04);
    } else {
      pulse("sine", 0.0, 0.08, 440, 520, 0.05);
    }

    audioContext.resume().catch(function () {
      return;
    });

    window.setTimeout(function () {
      audioContext.close().catch(function () {
        return;
      });
    }, 760);
  }

  function getLetterPhotos(page) {
    var photos = Array.isArray(page && page.photos) ? page.photos : [];
    return photos.filter(function (photo) {
      return photo && photo.dataUrl;
    });
  }

  function insertSoftHyphenBreaks(text) {
    var minWordLength = 12;
    var chunkSize = 8;

    return String(text || "").replace(/[A-Za-z]{12,}/g, function (word) {
      var parts = [];
      var cursor = 0;

      if (word.length < minWordLength) {
        return word;
      }

      while ((word.length - cursor) > chunkSize) {
        var remaining = word.length - cursor;
        var take = chunkSize;

        if ((remaining - take) < 4) {
          take = remaining - 4;
        }

        parts.push(word.slice(cursor, cursor + take));
        cursor += take;
      }

      parts.push(word.slice(cursor));
      return parts.join("\u00ad");
    });
  }

  function buildLetterBodyText(page) {
    var message = String(page && page.message ? page.message : "No letter content available.").trim() || "No letter content available.";

    return insertSoftHyphenBreaks(message);
  }

  function samplePastelPaletteFromImage(source) {
    return new Promise(function (resolve) {
      var fallback = {
        paper: "rgb(243, 228, 233)",
        accent: "rgb(196, 154, 170)"
      };
      var image = new Image();

      image.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          var context;
          var pixels;
          var index;
          var rTotal = 0;
          var gTotal = 0;
          var bTotal = 0;
          var count = 0;
          var avgR;
          var avgG;
          var avgB;
          var paperR;
          var paperG;
          var paperB;
          var accentR;
          var accentG;
          var accentB;

          canvas.width = 36;
          canvas.height = 36;
          context = canvas.getContext("2d", { willReadFrequently: true });

          if (!context) {
            resolve(fallback);
            return;
          }

          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

          for (index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 22) {
              continue;
            }

            rTotal += pixels[index];
            gTotal += pixels[index + 1];
            bTotal += pixels[index + 2];
            count += 1;
          }

          if (!count) {
            resolve(fallback);
            return;
          }

          avgR = rTotal / count;
          avgG = gTotal / count;
          avgB = bTotal / count;

          paperR = Math.round(avgR + ((255 - avgR) * 0.56));
          paperG = Math.round(avgG + ((255 - avgG) * 0.56));
          paperB = Math.round(avgB + ((255 - avgB) * 0.56));

          accentR = Math.max(28, Math.round((paperR * 0.72) + 12));
          accentG = Math.max(28, Math.round((paperG * 0.72) + 12));
          accentB = Math.max(28, Math.round((paperB * 0.72) + 12));

          resolve({
            paper: "rgb(" + paperR + ", " + paperG + ", " + paperB + ")",
            accent: "rgb(" + accentR + ", " + accentG + ", " + accentB + ")"
          });
        } catch (_error) {
          resolve(fallback);
        }
      };

      image.onerror = function () {
        resolve(fallback);
      };

      image.src = source;
    });
  }

  function initLoveLetterPinExperience(page) {
    suppressGlobalSiteModalsOnViewer();

    var classicCard = document.getElementById("viewerLetterClassicCard");
    var immersiveRoot = document.getElementById("viewerLetterImmersive");
    var volumeGate = document.getElementById("viewerLetterVolumeGate");
    var volumeButton = document.getElementById("viewerLetterVolumeButton");
    var lockStage = document.getElementById("viewerLetterLockStage");
    var lockTitle = document.getElementById("viewerLetterLockTitle");
    var lockStatus = document.getElementById("viewerLetterLockStatus");
    var heartPadlock = document.getElementById("viewerHeartPadlock");
    var pinDialHost = document.getElementById("viewerPinDialHost");
    var unlockButton = document.getElementById("viewerHeartUnlockButton");
    var envelopeStage = document.getElementById("viewerEnvelopeStage");
    var envelopeButton = document.getElementById("viewerEnvelopeButton");
    var paperModal = document.getElementById("viewerLetterPaperModal");
    var paperDate = document.getElementById("viewerLetterPaperDate");
    var paperRecipient = document.getElementById("viewerLetterPaperRecipient");
    var typedBody = document.getElementById("viewerLetterTypedBody");
    var paperClosing = document.getElementById("viewerLetterPaperClosing");
    var paperSignature = document.getElementById("viewerLetterPaperSignature");
    var nextButton = document.getElementById("viewerLetterToCollageButton");
    var collageStage = document.getElementById("viewerCollageStage");
    var backToLetterButton = document.getElementById("viewerBackToLetterButton");
    var createOwnLetterButton = document.getElementById("viewerCreateOwnLetterButton");
    var polaroidGrid = document.getElementById("viewerPolaroidGrid");
    var lightboxNode = document.getElementById("viewerPhotoLightbox");
    var lightboxFrame = document.getElementById("viewerPhotoLightboxFrame");
    var lightboxCaption = document.getElementById("viewerPhotoLightboxCaption");
    var lightboxCloseButton = document.getElementById("viewerPhotoLightboxClose");
    var pinDigits = [0, 0, 0, 0];
    var digitNodes = [
      document.getElementById("viewerPinDigit0"),
      document.getElementById("viewerPinDigit1"),
      document.getElementById("viewerPinDigit2"),
      document.getElementById("viewerPinDigit3")
    ];
    var expectedPin = String(page && page.pinCode ? page.pinCode : "").replace(/\D/g, "").slice(0, 4);
    var typingTimer = 0;
    var unlocked = false;
    var collageReady = false;
    var letterBodyText = buildLetterBodyText(page);
    var letterClosingText = String(page && page.closing ? page.closing : "Warmly,").trim() || "Warmly,";
    var letterSignatureText = String(page && page.signature ? page.signature : "Your Name").trim() || "Your Name";
    var letterPhotos = getLetterPhotos(page);
    var lightboxIndex = 0;
    var lightboxAnimating = false;
    var pointerTracking = false;
    var pointerStartX = 0;
    var pointerStartY = 0;
    var pointerId = -1;
    var touchTracking = false;
    var touchStartX = 0;
    var touchStartY = 0;
    var lastSwipeAt = 0;
    var lastTypingToneAt = 0;
    var envelopeOpening = false;
    var envelopeRevealTimer = 0;
    var letterEnterTimer = 0;
    var collageEnterTimer = 0;
    var unlockStageSwapTimer = 0;
    var collageRevealTimers = [];
    var letterMusicVideoId = extractYouTubeVideoId(page && page.youtubeUrl);
    var letterMusicMounted = false;
    var letterMusicStarted = false;
    var letterMusicUnmuted = false;

    if (!immersiveRoot || !volumeGate || !volumeButton || !lockStage || !heartPadlock || !pinDialHost || !unlockButton || !envelopeStage || !envelopeButton || !paperModal || !typedBody || !nextButton || !collageStage || !polaroidGrid || !lightboxNode || !lightboxFrame || !lightboxCaption || !lightboxCloseButton) {
      showContent(page);
      return;
    }

    setViewerMode("letter");
    document.body.classList.add("l4u-viewer-letter-immersive");

    if (classicCard) {
      classicCard.classList.add("hidden");
    }

    immersiveRoot.classList.remove("hidden");

    if (lockTitle) {
      lockTitle.textContent = page.title || "Enter the Heart Code";
    }

    function clearTypingTimer() {
      if (typingTimer) {
        window.clearTimeout(typingTimer);
        typingTimer = 0;
      }
    }

    function clearEnvelopeTimers() {
      if (envelopeRevealTimer) {
        window.clearTimeout(envelopeRevealTimer);
        envelopeRevealTimer = 0;
      }

      if (letterEnterTimer) {
        window.clearTimeout(letterEnterTimer);
        letterEnterTimer = 0;
      }
    }

    function clearCollageRevealTimers() {
      collageRevealTimers.forEach(function (timerId) {
        window.clearTimeout(timerId);
      });

      collageRevealTimers = [];
    }

    function clearCollageTimers() {
      if (collageEnterTimer) {
        window.clearTimeout(collageEnterTimer);
        collageEnterTimer = 0;
      }

      clearCollageRevealTimers();
    }

    function clearUnlockStageSwapTimer() {
      if (unlockStageSwapTimer) {
        window.clearTimeout(unlockStageSwapTimer);
        unlockStageSwapTimer = 0;
      }
    }

    function startLetterBackgroundMusic() {
      if (!letterMusicVideoId) {
        return;
      }

      if (!letterMusicMounted) {
        letterMusicMounted = mountCrtYouTube(letterMusicVideoId, true, true);
      }

      if (!letterMusicMounted) {
        return;
      }

      letterMusicStarted = true;

      if (!letterMusicUnmuted) {
        queueYouTubePlaybackAttempts(false, 72);
      }
    }

    function unmuteLetterBackgroundMusic() {
      if (!letterMusicVideoId) {
        return;
      }

      if (!letterMusicMounted) {
        letterMusicMounted = mountCrtYouTube(letterMusicVideoId, true, true);
      }

      if (!letterMusicMounted) {
        return;
      }

      letterMusicStarted = true;
      letterMusicUnmuted = true;
      queueYouTubePlaybackAttempts(true, 72);
    }

    function readPinDigitDisplay(node, fallbackValue) {
      var storedValue = String(node.getAttribute("data-digit-value") || "").trim();
      var activeNextNode = node.querySelector(".l4u-pin-digit-value.is-next");
      var nextValue;
      var rawText;

      if (/^\d$/.test(storedValue)) {
        return storedValue;
      }

      if (activeNextNode) {
        nextValue = String(activeNextNode.textContent || "").trim();
        if (/^\d$/.test(nextValue)) {
          return nextValue;
        }
      }

      rawText = String(node.textContent || "").trim();
      if (/^\d$/.test(rawText)) {
        return rawText;
      }

      return String(fallbackValue);
    }

    function setPinDigitDisplay(node, value) {
      var nextValue = String(value);

      if (node.__l4uDigitTimer) {
        window.clearTimeout(node.__l4uDigitTimer);
        node.__l4uDigitTimer = 0;
      }

      node.classList.remove("is-animating");
      node.innerHTML = "";
      node.textContent = nextValue;
      node.setAttribute("data-digit-value", nextValue);
    }

    function animatePinDigitDisplay(node, value, direction) {
      var nextValue = String(value);
      var currentValue = readPinDigitDisplay(node, nextValue);
      var incomingClass = direction === "down" ? "is-down-in" : "is-up-in";
      var outgoingClass = direction === "down" ? "is-down-out" : "is-up-out";
      var outgoingNode;
      var incomingNode;

      if (currentValue === nextValue) {
        setPinDigitDisplay(node, nextValue);
        return;
      }

      if (node.__l4uDigitTimer) {
        window.clearTimeout(node.__l4uDigitTimer);
        node.__l4uDigitTimer = 0;
      }

      outgoingNode = document.createElement("span");
      outgoingNode.className = "l4u-pin-digit-value " + outgoingClass;
      outgoingNode.textContent = currentValue;

      incomingNode = document.createElement("span");
      incomingNode.className = "l4u-pin-digit-value is-next " + incomingClass;
      incomingNode.textContent = nextValue;

      node.innerHTML = "";
      node.appendChild(outgoingNode);
      node.appendChild(incomingNode);
      node.classList.add("is-animating");
      node.setAttribute("data-digit-value", nextValue);

      window.requestAnimationFrame(function () {
        outgoingNode.classList.add("is-active");
        incomingNode.classList.add("is-active");
      });

      node.__l4uDigitTimer = window.setTimeout(function () {
        setPinDigitDisplay(node, nextValue);
      }, 220);
    }

    function updatePinDigits(changedIndex, direction) {
      digitNodes.forEach(function (node, index) {
        if (!node) {
          return;
        }

        if (index === changedIndex && (direction === "up" || direction === "down")) {
          animatePinDigitDisplay(node, pinDigits[index], direction);
          return;
        }

        setPinDigitDisplay(node, pinDigits[index]);
      });
    }

    function getCurrentPin() {
      return pinDigits.join("");
    }

    function triggerWrongPin() {
      if (lockStatus) {
        lockStatus.textContent = "Wrong code. Try again.";
      }

      heartPadlock.classList.remove("is-wrong");
      void heartPadlock.offsetWidth;
      heartPadlock.classList.add("is-wrong");
      playLetterActionTone("pin-wrong");
      playLetterWarningTone("error");

      window.setTimeout(function () {
        heartPadlock.classList.remove("is-wrong");
      }, 460);
    }

    function showEnvelopeStage() {
      clearUnlockStageSwapTimer();
      lockStage.classList.remove("is-sliding-out");
      envelopeStage.classList.remove("is-sliding-in");
      envelopeStage.classList.remove("hidden");

      void envelopeStage.offsetWidth;
      lockStage.classList.add("is-sliding-out");
      envelopeStage.classList.add("is-sliding-in");

      unlockStageSwapTimer = window.setTimeout(function () {
        unlockStageSwapTimer = 0;
        lockStage.classList.add("hidden");
        lockStage.classList.remove("is-sliding-out");
        envelopeStage.classList.remove("is-sliding-in");
      }, 640);

      if (lockStatus) {
        lockStatus.textContent = "Unlocked.";
      }
    }

    function triggerUnlockSuccess() {
      if (unlocked) {
        return;
      }

      unlocked = true;
      heartPadlock.classList.remove("is-wrong");
      heartPadlock.classList.add("is-unlocking");
      startLetterBackgroundMusic();

      if (lockStatus) {
        lockStatus.textContent = "Code accepted. Unlocking...";
      }

      playLetterActionTone("pin-correct");
      playLetterWarningTone("unlock");

      window.setTimeout(function () {
        heartPadlock.classList.add("is-unlocked");
        showEnvelopeStage();
      }, 880);
    }

    function attemptUnlock() {
      if (expectedPin.length !== 4) {
        triggerUnlockSuccess();
        return;
      }

      if (getCurrentPin() !== expectedPin) {
        triggerWrongPin();
        return;
      }

      triggerUnlockSuccess();
    }

    function setLightboxCaption() {
      if (!lightboxCaption || !letterPhotos.length) {
        return;
      }

      lightboxCaption.textContent = "Photo " + (lightboxIndex + 1) + " of " + letterPhotos.length;
    }

    function createLightboxPhotoNode(source, altText) {
      var image = document.createElement("img");
      image.className = "l4u-lightbox-photo";
      image.src = source;
      image.alt = altText;
      image.draggable = false;
      return image;
    }

    function showLightboxAt(index) {
      if (!letterPhotos.length) {
        return;
      }

      lightboxIndex = (index + letterPhotos.length) % letterPhotos.length;
      lightboxAnimating = false;
      lightboxFrame.innerHTML = "";

      var currentPhoto = letterPhotos[lightboxIndex];
      var currentNode = createLightboxPhotoNode(currentPhoto.dataUrl, "Memory photo " + (lightboxIndex + 1));
      currentNode.classList.add("l4u-lightbox-photo-current");
      lightboxFrame.appendChild(currentNode);

      lightboxNode.classList.remove("hidden");
      lightboxNode.classList.add("is-open");
      document.body.classList.add("l4u-lightbox-no-select");
      setLightboxCaption();
    }

    function closeLightbox() {
      lightboxNode.classList.add("hidden");
      lightboxNode.classList.remove("is-open");
      lightboxFrame.innerHTML = "";
      lightboxAnimating = false;
      pointerTracking = false;
      pointerId = -1;
      touchTracking = false;
      document.body.classList.remove("l4u-lightbox-no-select");
    }

    function transitionLightbox(step) {
      if (lightboxAnimating || !letterPhotos.length || lightboxNode.classList.contains("hidden")) {
        return;
      }

      var currentNode = lightboxFrame.querySelector(".l4u-lightbox-photo-current");
      var nextIndex = (lightboxIndex + step + letterPhotos.length) % letterPhotos.length;
      var incomingNode;

      if (!currentNode) {
        showLightboxAt(nextIndex);
        return;
      }

      incomingNode = createLightboxPhotoNode(letterPhotos[nextIndex].dataUrl, "Memory photo " + (nextIndex + 1));
      incomingNode.classList.add("l4u-lightbox-photo-incoming");
      incomingNode.classList.add(step > 0 ? "from-right" : "from-left");

      lightboxAnimating = true;
      playLetterActionTone("swipe", step);
      lightboxFrame.appendChild(incomingNode);

      window.requestAnimationFrame(function () {
        currentNode.classList.add(step > 0 ? "to-left" : "to-right");
        incomingNode.classList.add("is-active");
      });

      window.setTimeout(function () {
        currentNode.remove();
        incomingNode.className = "l4u-lightbox-photo l4u-lightbox-photo-current";
        lightboxIndex = nextIndex;
        lightboxAnimating = false;
        setLightboxCaption();
      }, 330);
    }

    function triggerSwipe(step) {
      var now = Date.now();

      if ((now - lastSwipeAt) < 220) {
        return;
      }

      lastSwipeAt = now;
      transitionLightbox(step);
    }

    function resolveSwipe(deltaX, deltaY) {
      var absX = Math.abs(deltaX);
      var absY = Math.abs(deltaY);

      if (absX < 36) {
        return false;
      }

      if (absX <= (absY * 1.08)) {
        return false;
      }

      triggerSwipe(deltaX < 0 ? 1 : -1);
      return true;
    }

    function renderPolaroidCollage() {
      if (collageReady) {
        return;
      }

      collageReady = true;
      clearCollageRevealTimers();
      polaroidGrid.innerHTML = "";

      if (!letterPhotos.length) {
        polaroidGrid.innerHTML = '<p class="l4u-polaroid-empty">No photos were attached to this letter.</p>';
        return;
      }

      letterPhotos.forEach(function (photo, index) {
        var card = document.createElement("button");
        var image = document.createElement("img");
        var revealDelayMs = 180 + (index * 1000);
        var revealTimer = 0;

        card.type = "button";
        card.className = "l4u-love-polaroid is-staged";
        card.disabled = true;
        card.style.setProperty("--l4u-polaroid-tilt", randomBetween(-4.8, 4.8).toFixed(2) + "deg");
        card.style.setProperty("--l4u-polaroid-paper", "rgb(243, 228, 233)");
        card.style.setProperty("--l4u-polaroid-accent", "rgb(196, 154, 170)");
        card.setAttribute("aria-label", "Open photo " + (index + 1));

        image.src = photo.dataUrl;
        image.alt = "Letter memory photo " + (index + 1);
        image.loading = "lazy";
        card.appendChild(image);

        card.addEventListener("click", function () {
          showLightboxAt(index);
        });

        polaroidGrid.appendChild(card);

        revealTimer = window.setTimeout(function () {
          card.classList.remove("is-staged");
          card.classList.add("is-revealed");
          card.disabled = false;
        }, revealDelayMs);

        collageRevealTimers.push(revealTimer);

        samplePastelPaletteFromImage(photo.dataUrl).then(function (palette) {
          card.style.setProperty("--l4u-polaroid-paper", palette.paper);
          card.style.setProperty("--l4u-polaroid-accent", palette.accent);
        });
      });
    }

    function startTypingLetter() {
      var pointer = 0;

      clearTypingTimer();

      function maybePlayTypingTone(character) {
        var now = Date.now();

        if (!character || /\s/.test(character) || character === "\u00ad") {
          return;
        }

        if ((now - lastTypingToneAt) < 38) {
          return;
        }

        lastTypingToneAt = now;
        playLetterActionTone("typing");
      }

      syncLetterPaperMeta();

      typedBody.textContent = "";
      typedBody.scrollTop = 0;
      typedBody.classList.add("is-typing");
      nextButton.classList.add("hidden");

      function typeNextChar() {
        if (pointer >= letterBodyText.length) {
          typedBody.classList.remove("is-typing");
          nextButton.classList.remove("hidden");
          return;
        }

        var character = letterBodyText.charAt(pointer);
        var delay = 24;

        typedBody.textContent += character;
        typedBody.scrollTop = typedBody.scrollHeight;
        maybePlayTypingTone(character);
        pointer += 1;

        if (character === "\n") {
          delay = 120;
        } else if (character === "\u00ad") {
          delay = 0;
        } else if (character === "." || character === "," || character === "!" || character === "?") {
          delay = 56;
        }

        typingTimer = window.setTimeout(typeNextChar, delay);
      }

      typeNextChar();
    }

    function syncLetterPaperMeta() {
      if (paperDate) {
        paperDate.textContent = formatDate(page.date || page.createdAt);
      }

      if (paperRecipient) {
        paperRecipient.textContent = page.recipient ? "Dear " + page.recipient + "," : "Dear recipient,";
      }

      if (paperClosing) {
        paperClosing.textContent = letterClosingText;
      }

      if (paperSignature) {
        paperSignature.textContent = letterSignatureText;
      }
    }

    function returnToEnvelopeStage() {
      closeLightbox();
      clearTypingTimer();
      clearEnvelopeTimers();
      clearCollageTimers();
      clearUnlockStageSwapTimer();
      syncLetterPaperMeta();
      typedBody.textContent = "";
      typedBody.scrollTop = 0;
      typedBody.classList.remove("is-typing");
      nextButton.classList.add("hidden");
      collageReady = false;
      polaroidGrid.innerHTML = "";
      collageStage.classList.add("hidden");
      collageStage.classList.remove("is-entering");
      paperModal.classList.add("hidden");
      paperModal.classList.remove("is-entering");
      lockStage.classList.add("hidden");
      lockStage.classList.remove("is-sliding-out");
      envelopeOpening = false;
      envelopeButton.disabled = false;
      envelopeButton.classList.remove("is-opening");
      envelopeStage.classList.remove("is-sliding-in");
      envelopeStage.classList.remove("hidden");
      setStatus("Envelope ready. Tap to open again.");

      if (lockStatus) {
        lockStatus.textContent = "Unlocked. Tap the envelope to read again.";
      }
    }

    function goToOfficialHome() {
      var destination = "/#hero";

      if (window.location && window.location.protocol === "file:") {
        destination = "index.html#hero";
      }

      window.location.href = destination;
    }

    function revealLetterPaper() {
      if (envelopeOpening) {
        return;
      }

      envelopeOpening = true;
      envelopeButton.disabled = true;
      envelopeButton.classList.add("is-opening");
      clearEnvelopeTimers();
      clearTypingTimer();
      closeLightbox();
      collageStage.classList.add("hidden");
      collageStage.classList.remove("is-entering");
      paperModal.classList.add("hidden");
      paperModal.classList.remove("is-entering");
      typedBody.textContent = "";
      typedBody.scrollTop = 0;
      typedBody.classList.remove("is-typing");
      nextButton.classList.add("hidden");

      if (lockStatus) {
        lockStatus.textContent = "Opening letter...";
      }

      envelopeRevealTimer = window.setTimeout(function () {
        envelopeRevealTimer = 0;
        paperModal.classList.remove("hidden");
        paperModal.classList.add("is-entering");

        letterEnterTimer = window.setTimeout(function () {
          letterEnterTimer = 0;
          paperModal.classList.remove("is-entering");
        }, 560);

        startTypingLetter();
        envelopeButton.classList.remove("is-opening");
        envelopeButton.disabled = false;
        envelopeOpening = false;
      }, 900);
    }

    function revealCollage() {
      clearCollageTimers();
      closeLightbox();
      lockStage.classList.add("hidden");
      envelopeStage.classList.add("hidden");
      paperModal.classList.add("hidden");
      paperModal.classList.remove("is-entering");
      collageStage.classList.remove("hidden");
      collageStage.classList.remove("is-entering");
      void collageStage.offsetWidth;
      collageStage.classList.add("is-entering");

      collageEnterTimer = window.setTimeout(function () {
        collageEnterTimer = 0;
        collageStage.classList.remove("is-entering");
      }, 620);

      renderPolaroidCollage();
      setStatus("Unlocked. Swipe through memories.");
    }

    function handlePinDialClick(event) {
      var button = event.target.closest(".l4u-pin-step");
      var index;
      var step;

      if (!button) {
        return;
      }

      index = toNumber(button.getAttribute("data-index"), -1);
      step = toNumber(button.getAttribute("data-step"), 0);

      if (index < 0 || index > 3 || !step) {
        return;
      }

      pinDigits[index] = (pinDigits[index] + step + 10) % 10;
      updatePinDigits(index, step > 0 ? "up" : "down");
      playLetterActionTone("dial");
    }

    function handleWindowKeydown(event) {
      if (!lockStage.classList.contains("hidden") && event.key === "Enter") {
        event.preventDefault();
        attemptUnlock();
        return;
      }

      if (lightboxNode.classList.contains("hidden")) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        transitionLightbox(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        transitionLightbox(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
      }
    }

    pinDialHost.addEventListener("click", handlePinDialClick);
    unlockButton.addEventListener("click", attemptUnlock);

    volumeButton.addEventListener("click", function () {
      startLetterBackgroundMusic();

      volumeGate.classList.add("is-hidden");
      lockStage.classList.remove("hidden");
      playLetterWarningTone("start");
      setStatus("Pin locked. Enter the heart code.");
      if (lockStatus) {
        lockStatus.textContent = "Warning tone played. Enter the 4-digit pin.";
      }
    });

    envelopeButton.addEventListener("click", function () {
      unmuteLetterBackgroundMusic();
      revealLetterPaper();
    });
    nextButton.addEventListener("click", revealCollage);

    if (backToLetterButton) {
      backToLetterButton.addEventListener("click", returnToEnvelopeStage);
    }

    if (createOwnLetterButton) {
      createOwnLetterButton.addEventListener("click", goToOfficialHome);
    }

    lightboxCloseButton.addEventListener("click", closeLightbox);
    lightboxNode.addEventListener("click", function (event) {
      if (event.target === lightboxNode) {
        closeLightbox();
      }
    });

    lightboxFrame.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch" || event.button !== 0) {
        return;
      }

      event.preventDefault();

      pointerTracking = true;
      pointerId = event.pointerId;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;

      try {
        lightboxFrame.setPointerCapture(event.pointerId);
      } catch (_error) {
        return;
      }
    });

    lightboxFrame.addEventListener("pointermove", function (event) {
      var deltaX;
      var deltaY;

      if (event.pointerType === "touch" || !pointerTracking || event.pointerId !== pointerId) {
        return;
      }

      deltaX = event.clientX - pointerStartX;
      deltaY = event.clientY - pointerStartY;

      if (Math.abs(deltaX) < 14) {
        return;
      }

      event.preventDefault();

      if (!resolveSwipe(deltaX, deltaY)) {
        return;
      }

      pointerTracking = false;
      pointerId = -1;

      try {
        lightboxFrame.releasePointerCapture(event.pointerId);
      } catch (_error) {
        return;
      }
    });

    lightboxFrame.addEventListener("pointerup", function (event) {
      var deltaX;
      var deltaY;

      if (event.pointerType === "touch" || !pointerTracking || event.pointerId !== pointerId) {
        return;
      }

      event.preventDefault();

      pointerTracking = false;
      pointerId = -1;
      deltaX = event.clientX - pointerStartX;
      deltaY = event.clientY - pointerStartY;
      resolveSwipe(deltaX, deltaY);

      try {
        lightboxFrame.releasePointerCapture(event.pointerId);
      } catch (_error) {
        return;
      }
    });

    lightboxFrame.addEventListener("pointercancel", function () {
      pointerTracking = false;
      pointerId = -1;
    });

    lightboxFrame.addEventListener("mousedown", function (event) {
      if (event.button === 0) {
        event.preventDefault();
      }
    });

    lightboxFrame.addEventListener("selectstart", function (event) {
      event.preventDefault();
    });

    lightboxFrame.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });

    lightboxFrame.addEventListener("touchstart", function (event) {
      var firstTouch = event.touches && event.touches[0];
      if (!firstTouch) {
        return;
      }

      touchTracking = true;
      touchStartX = firstTouch.clientX;
      touchStartY = firstTouch.clientY;
    }, { passive: true });

    lightboxFrame.addEventListener("touchend", function (event) {
      var firstTouch;
      var deltaX;
      var deltaY;

      if (!touchTracking) {
        return;
      }

      touchTracking = false;
      firstTouch = event.changedTouches && event.changedTouches[0];

      if (!firstTouch) {
        return;
      }

      deltaX = firstTouch.clientX - touchStartX;
      deltaY = firstTouch.clientY - touchStartY;
      resolveSwipe(deltaX, deltaY);
    }, { passive: true });

    lightboxFrame.addEventListener("touchcancel", function () {
      touchTracking = false;
    }, { passive: true });

    window.addEventListener("keydown", handleWindowKeydown);
    window.addEventListener("beforeunload", function () {
      clearTypingTimer();
      clearEnvelopeTimers();
      clearCollageTimers();
      clearUnlockStageSwapTimer();

      if (letterMusicMounted) {
        sendYouTubeCommand("pauseVideo");
        mountCrtYouTube("", false);
        letterMusicMounted = false;
      }

      document.body.classList.remove("l4u-lightbox-no-select");
    });

    lockStage.classList.remove("hidden");
    lockStage.classList.remove("is-sliding-out");
    envelopeStage.classList.add("hidden");
    envelopeStage.classList.remove("is-sliding-in");
    paperModal.classList.add("hidden");
    collageStage.classList.add("hidden");
    collageStage.classList.remove("is-entering");
    lightboxNode.classList.add("hidden");
    volumeGate.classList.remove("is-hidden");

    startLetterBackgroundMusic();
    updatePinDigits();

    setStatus("Private page loaded. Continue to unlock.");
  }

  function loadPublishedPage() {
    var pageId = getPageIdFromLocation();

    syncViewerLocation(pageId);
    syncViewerShareMeta(pageId, "");

    suppressGlobalSiteModalsOnViewer();

    showLoadingScreen();

    if (!pageId) {
      setStatus("Missing page id. Use a valid share link.");
      hideLoadingScreen();
      return;
    }

    setStatus("Fetching page from Firestore...");

    if (!window.L4UFirebaseReady || typeof window.L4UFirebaseReady.then !== "function") {
      setStatus("Firebase is not ready in this context.");
      hideLoadingScreen();
      return;
    }

    window.L4UFirebaseReady
      .then(function (api) {
        if (!api || typeof api.getPageById !== "function") {
          throw new Error("Page lookup API is unavailable.");
        }

        return api.getPageById(pageId);
      })
      .then(function (page) {
        if (!page) {
          setStatus("Page not found.");
          hideLoadingScreen();
          return;
        }

        if (page && page.title) {
          document.title = page.title + " | Letter4U Viewer";
        }

        syncViewerShareMeta(pageId, page && page.title ? page.title : "");

        if (String(page.templateType || "") === "crt-retro") {
          showCrtContent(page);
          hideLoadingScreen();
          return;
        }

        if (/^\d{4}$/.test(String(page.pinCode || "").trim())) {
          initLoveLetterPinExperience(page);
          hideLoadingScreen();
          return;
        }

        showContent(page);
        hideLoadingScreen();
      })
      .catch(function () {
        setStatus("Could not load page. Check Firestore rules and published page id.");
        hideLoadingScreen();
      });
  }

  loadPublishedPage();
})();
