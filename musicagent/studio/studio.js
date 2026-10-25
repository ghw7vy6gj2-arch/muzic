(() => {
  "use strict";

  const styleNames = {
    industrial: "Industrial",
    hardtechno: "Hard techno",
    metal: "Heavy metal",
    ambient: "Dark ambient",
  };
  const trackNames = ["KICK", "SNARE", "HATS", "BASS", "LEAD"];
  const trackIds = ["kick", "snare", "hat", "bass", "lead"];
  const layouts = {
    kick: [0.24, 0.24, 0.82, 0.62, 0.08, 0.08],
    snare: [0.4, 0.4, 0.46, 0, 0.32, 0.32],
    hat: [0.43, 0.43, 0.1, 0, 0.54, 0.54],
    bass: [0.32, 0.32, 0.35, 0.46, 0.18, 0.18],
    lead: [0.38, 0.38, 0.22, 0, 0.36, 0.36],
  };
  const elements = {
    play: document.querySelector("#play"),
    playIcon: document.querySelector("#play-icon"),
    stop: document.querySelector("#stop"),
    generate: document.querySelector("#generate"),
    generateSecondary: document.querySelector("#generate-secondary"),
    tempo: document.querySelector("#tempo"),
    tempoValue: document.querySelector("#tempo-value"),
    style: document.querySelector("#style"),
    seed: document.querySelector("#seed"),
    randomSeed: document.querySelector("#random-seed"),
    drive: document.querySelector("#drive"),
    driveValue: document.querySelector("#drive-value"),
    mix: document.querySelector("#mix"),
    mixValue: document.querySelector("#mix-value"),
    humanize: document.querySelector("#humanize"),
    humanizeValue: document.querySelector("#humanize-value"),
    humanizeSummary: document.querySelector("#humanize-summary"),
    timeline: document.querySelector("#timeline"),
    trackTitle: document.querySelector("#track-title"),
    transportState: document.querySelector("#transport-state"),
    effectIndicator: document.querySelector("#effect-indicator"),
    effectState: document.querySelector("#effect-state"),
    channelBadge: document.querySelector("#channel-badge"),
    outputTitle: document.querySelector("#output-title"),
    outputCopy: document.querySelector("#output-copy"),
    outputNote: document.querySelector("#output-note"),
    photoInput: document.querySelector("#photo-input"),
    photoOptions: document.querySelector("#photo-options"),
  };

  let arrangement = null;
  let audioContext = null;
  let speakerNodes = [];
  let channelMerger = null;
  let trackRoutes = {};
  let noiseBuffer = null;
  let timerId = null;
  let animationId = null;
  let nextStepTime = 0;
  let playbackStartTime = 0;
  let stepIndex = 0;
  let isPlaying = false;
  let isPaused = false;

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeEvent(random, note = null) {
    return { velocity: 0.68 + random() * 0.3, note };
  }

  function createArrangement(style, seed) {
    const random = seededRandom(seed);
    const arrangement = Object.fromEntries(trackIds.map((id) => [id, Array(64).fill(null)]));
    const kickPatterns = {
      industrial: [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0],
      hardtechno: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      metal: [1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0],
      ambient: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    };
    const kickPattern = kickPatterns[style];
    const scales = {
      industrial: [0, 3, 5, 7, 10],
      hardtechno: [0, 2, 3, 7, 9],
      metal: [0, 2, 3, 5, 7, 10],
      ambient: [0, 2, 5, 7, 9],
    };
    const scale = scales[style];

    for (let bar = 0; bar < 4; bar += 1) {
      const barStart = bar * 16;
      for (let beat = 0; beat < 16; beat += 1) {
        const index = barStart + beat;
        if (kickPattern[beat] || (style !== "ambient" && beat % 16 === 15 && random() < 0.16)) {
          arrangement.kick[index] = makeEvent(random);
        }

        const snareBeat = [4, 12];
        if (snareBeat.includes(beat) && (style !== "ambient" || random() < 0.65)) {
          arrangement.snare[index] = makeEvent(random);
        } else if (beat % 4 === 2 && style !== "ambient" && random() < 0.15) {
          arrangement.snare[index] = makeEvent(random);
        }

        const hatChance = style === "ambient" ? 0.22 : style === "metal" ? 0.56 : 0.64;
        if (beat % 2 === 0 && random() < hatChance) {
          arrangement.hat[index] = makeEvent(random);
        }

        if (beat % (style === "ambient" ? 8 : 4) === 0 && (arrangement.kick[index] || random() < 0.35)) {
          const octave = style === "metal" && random() < 0.35 ? 24 : 36;
          arrangement.bass[index] = makeEvent(random, octave + scale[Math.floor(random() * scale.length)]);
        }

        const leadChance = style === "ambient" ? 0.3 : style === "metal" ? 0.22 : 0.19;
        if (beat % 2 === 0 && random() < leadChance) {
          arrangement.lead[index] = makeEvent(random, 60 + scale[Math.floor(random() * scale.length)] + (random() < 0.25 ? 12 : 0));
        }
      }
    }

    if (!arrangement.lead.some(Boolean)) {
      arrangement.lead[0] = makeEvent(random, 60);
      arrangement.lead[32] = makeEvent(random, 67);
    }
    return arrangement;
  }

  function renderArrangement() {
    elements.timeline.replaceChildren();
    for (let track = 0; track < trackIds.length; track += 1) {
      const trackId = trackIds[track];
      const row = document.createElement("div");
      row.className = "grid-track";
      row.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "grid-track-name";
      name.textContent = trackNames[track];
      row.append(name);

      const cells = document.createElement("div");
      cells.className = "grid-steps";
      for (let step = 0; step < 64; step += 1) {
        const cell = document.createElement("i");
        cell.className = `grid-step${arrangement[trackId][step] ? ` active ${trackId}` : ""}`;
        cell.dataset.step = String(step);
        cells.append(cell);
      }
      row.append(cells);
      elements.timeline.append(row);
    }
  }

  function setHumanizeSummary() {
    const feel = Number(elements.humanize.value);
    const timing = Math.round((feel / 100) * 24);
    const velocity = Math.round((feel / 100) * 26);
    elements.humanizeValue.value = `${feel}%`;
    elements.humanizeSummary.textContent = `±${timing} ms timing · ±${velocity}% velocity`;
  }

  function setWaveShaper() {
    if (!audioContext) return;
    const drive = Number(elements.drive.value) / 100;
    const curve = new Float32Array(44100);
    const amount = 1 + drive * 28;
    const normalization = Math.tanh(amount);
    for (let index = 0; index < curve.length; index += 1) {
      const input = (index * 2) / (curve.length - 1) - 1;
      curve[index] = Math.tanh(input * amount) / normalization;
    }
    for (const route of Object.values(trackRoutes)) route.shaper.curve = curve;

    const wet = Number(elements.mix.value) / 100;
    const now = audioContext.currentTime;
    const dryGain = Math.cos((wet * Math.PI) / 2);
    const wetGain = Math.sin((wet * Math.PI) / 2);
    for (const route of Object.values(trackRoutes)) {
      route.dry.gain.setTargetAtTime(dryGain, now, 0.015);
      route.wet.gain.setTargetAtTime(wetGain, now, 0.015);
    }
    elements.driveValue.value = `${elements.drive.value}%`;
    elements.mixValue.value = `${elements.mix.value}%`;
  }

  function initializeAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported by this browser.");

    audioContext = new AudioContextClass({ latencyHint: "interactive" });
    const destination = audioContext.destination;
    const maxChannels = Number(destination.maxChannelCount) || 2;
    let channelCount = maxChannels >= 6 ? 6 : 2;
    try {
      destination.channelCount = channelCount;
      destination.channelCountMode = "explicit";
      destination.channelInterpretation = "speakers";
    } catch {
      channelCount = 2;
      destination.channelCountMode = "explicit";
      destination.channelInterpretation = "speakers";
      destination.channelCount = Math.min(2, maxChannels);
    }

    channelMerger = audioContext.createChannelMerger(6);
    channelMerger.channelInterpretation = "discrete";
    channelMerger.connect(destination);
    speakerNodes = [];
    for (let channel = 0; channel < 6; channel += 1) {
      const output = audioContext.createGain();
      output.gain.value = 1;
      output.connect(channelMerger, 0, channel);
      speakerNodes.push(output);
    }

    for (const trackId of trackIds) {
      const input = audioContext.createGain();
      const dry = audioContext.createGain();
      const wet = audioContext.createGain();
      const shaper = audioContext.createWaveShaper();
      const sum = audioContext.createGain();
      const level = audioContext.createGain();
      level.gain.value = trackId === "hat" ? 0.26 : trackId === "lead" ? 0.24 : 0.3;
      input.connect(dry);
      dry.connect(sum);
      input.connect(shaper);
      shaper.connect(wet);
      wet.connect(sum);
      sum.connect(level);
      layouts[trackId].forEach((gain, channel) => {
        const route = audioContext.createGain();
        route.gain.value = gain;
        level.connect(route);
        if (channel === 3) {
          const lowPass = audioContext.createBiquadFilter();
          lowPass.type = "lowpass";
          lowPass.frequency.value = 120;
          lowPass.Q.value = 0.707;
          route.connect(lowPass);
          lowPass.connect(speakerNodes[channel]);
        } else {
          route.connect(speakerNodes[channel]);
        }
      });
      trackRoutes[trackId] = { input, dry, wet, shaper };
    }

    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;
    setWaveShaper();
    updateOutputStatus(channelCount);
  }

  function updateOutputStatus(channelCount) {
    if (channelCount >= 6) {
      elements.channelBadge.textContent = "5.1 READY";
      elements.outputTitle.textContent = "6-channel surround";
      elements.outputCopy.textContent = "Discrete L · R · C · LFE · LS · RS routing is active.";
      elements.outputNote.textContent = "5.1 playback also depends on your browser, operating system, and selected audio device.";
    } else {
      elements.channelBadge.textContent = "STEREO";
      elements.outputTitle.textContent = "Stereo playback";
      elements.outputCopy.textContent = "Your current browser output exposes two channels; the mix is downmixed for stereo.";
      elements.outputNote.textContent = "Connect and select a 5.1-capable output, then reload this page to enable surround routing.";
    }
  }

  function midiFrequency(note) {
    return 440 * 2 ** ((note - 69) / 12);
  }

  function makeEnvelope(trackId, event, when, duration) {
    const context = audioContext;
    const envelope = context.createGain();
    const humanize = Number(elements.humanize.value) / 100;
    const velocity = Math.max(0.1, Math.min(1, event.velocity + (Math.random() * 2 - 1) * humanize * 0.26));
    const end = when + duration;
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.linearRampToValueAtTime(velocity, when + Math.min(0.008, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(trackRoutes[trackId].input);
    return { envelope, end };
  }

  function scheduleTone(trackId, event, when, duration, type, startFrequency, endFrequency = null) {
    const oscillator = audioContext.createOscillator();
    const envelope = makeEnvelope(trackId, event, when, duration);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, when);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration * 0.8);
    oscillator.connect(envelope.envelope);
    oscillator.start(when);
    oscillator.stop(envelope.end + 0.01);
  }

  function scheduleNoise(trackId, event, when, duration, frequency) {
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const envelope = makeEnvelope(trackId, event, when, duration);
    source.buffer = noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(frequency, when);
    source.connect(filter);
    filter.connect(envelope.envelope);
    source.start(when);
    source.stop(envelope.end + 0.01);
  }

  function scheduleEvent(trackId, event, stepTime, stepDuration) {
    const feel = Number(elements.humanize.value) / 100;
    const jitter = (Math.random() * 2 - 1) * feel * 0.024;
    const when = Math.max(audioContext.currentTime + 0.004, stepTime + jitter);
    switch (trackId) {
      case "kick":
        scheduleTone(trackId, event, when, 0.23, "sine", 115, 42);
        break;
      case "snare":
        scheduleNoise(trackId, event, when, 0.15, 850);
        break;
      case "hat":
        scheduleNoise(trackId, event, when, 0.045, 6500);
        break;
      case "bass":
        scheduleTone(trackId, event, when, Math.min(0.21, stepDuration * 1.8), "sawtooth", midiFrequency(event.note));
        break;
      case "lead":
        scheduleTone(trackId, event, when, Math.min(0.16, stepDuration * 1.4), "triangle", midiFrequency(event.note));
        break;
      default:
        break;
    }
  }

  function scheduleStep(step, when, stepDuration) {
    for (const trackId of trackIds) {
      const event = arrangement[trackId][step];
      if (event) scheduleEvent(trackId, event, when, stepDuration);
    }
  }

  function scheduler() {
    const bpm = Number(elements.tempo.value);
    const stepDuration = 60 / bpm / 4;
    while (nextStepTime < audioContext.currentTime + 0.11) {
      scheduleStep(stepIndex, nextStepTime, stepDuration);
      nextStepTime += stepDuration;
      stepIndex = (stepIndex + 1) % 64;
    }
  }

  function updatePlayhead() {
    if (!isPlaying || isPaused) return;
    const stepDuration = 60 / Number(elements.tempo.value) / 4;
    const step = Math.floor((audioContext.currentTime - playbackStartTime) / stepDuration) % 64;
    elements.timeline.querySelectorAll(".grid-step.playhead").forEach((cell) => cell.classList.remove("playhead"));
    elements.timeline.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playhead"));
    animationId = window.requestAnimationFrame(updatePlayhead);
  }

  function setTransportState(text) {
    elements.transportState.textContent = text;
  }

  async function togglePlayback() {
    try {
      if (!audioContext) initializeAudio();
      if (!arrangement) generateArrangement();

      if (isPlaying && !isPaused) {
        isPaused = true;
        clearInterval(timerId);
        await audioContext.suspend();
        elements.playIcon.textContent = "▶";
        elements.play.setAttribute("aria-label", "Resume playback");
        setTransportState("Paused");
        return;
      }

      await audioContext.resume();
      speakerNodes.forEach((node) => node.gain.setValueAtTime(1, audioContext.currentTime));
      if (isPaused) {
        isPaused = false;
        timerId = window.setInterval(scheduler, 25);
        elements.playIcon.textContent = "Ⅱ";
        elements.play.setAttribute("aria-label", "Pause playback");
        setTransportState(`${styleNames[elements.style.value]} · ${elements.tempo.value} BPM`);
        updatePlayhead();
        return;
      }

      isPlaying = true;
      isPaused = false;
      stepIndex = 0;
      nextStepTime = audioContext.currentTime + 0.06;
      playbackStartTime = nextStepTime;
      scheduler();
      timerId = window.setInterval(scheduler, 25);
      elements.playIcon.textContent = "Ⅱ";
      elements.play.setAttribute("aria-label", "Pause playback");
      elements.stop.disabled = false;
      elements.generate.disabled = true;
      elements.generateSecondary.disabled = true;
      elements.effectIndicator.style.background = "#ff624b";
      elements.effectState.textContent = "Brutalizer active · real-time processing";
      setTransportState(`${styleNames[elements.style.value]} · ${elements.tempo.value} BPM`);
      updatePlayhead();
    } catch (error) {
      setTransportState(error.message || "Audio could not be started");
    }
  }

  function stopPlayback() {
    if (!audioContext || !isPlaying) return;
    clearInterval(timerId);
    window.cancelAnimationFrame(animationId);
    const now = audioContext.currentTime;
    speakerNodes.forEach((node) => {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(0, now);
    });
    isPlaying = false;
    isPaused = false;
    elements.playIcon.textContent = "▶";
    elements.play.setAttribute("aria-label", "Play");
    elements.stop.disabled = true;
    elements.generate.disabled = false;
    elements.generateSecondary.disabled = false;
    elements.effectIndicator.style.background = "#ff624b";
    elements.effectState.textContent = "Effect ready · engage playback to hear it";
    setTransportState("Stopped");
    elements.timeline.querySelectorAll(".grid-step.playhead").forEach((cell) => cell.classList.remove("playhead"));
  }

  function generateArrangement() {
    const style = elements.style.value;
    const seedValue = Number.parseInt(elements.seed.value, 10);
    const seed = Number.isFinite(seedValue) ? Math.max(0, seedValue) : 0;
    elements.seed.value = String(seed);
    arrangement = createArrangement(style, seed);
    renderArrangement();
    elements.play.disabled = false;
    elements.trackTitle.textContent = `${styleNames[style]} · Session ${seed}`;
    elements.transportState.textContent = `4 bars · ${elements.tempo.value} BPM · seed ${seed}`;
  }

  function updateHumanizeFeel() {
    setHumanizeSummary();
  }

  function updateArrangementTempo() {
    elements.tempoValue.value = elements.tempo.value;
    if (arrangement && !isPlaying) {
      setTransportState(`4 bars · ${elements.tempo.value} BPM · seed ${elements.seed.value}`);
    }
  }

  function randomizeSeed() {
    elements.seed.value = String(Math.floor(Math.random() * 999999));
  }

  function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    let saturation = 0;
    const lightness = (max + min) / 2;
    if (delta !== 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { hue, saturation, lightness };
  }

  async function analyzePhoto(file) {
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Images must be smaller than 15 MB.");
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 32, 32);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let luminance = 0;
    let saturation = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      luminance += (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
      saturation += rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]).saturation;
    }
    const count = pixels.length / 4;
    red = Math.round(red / count);
    green = Math.round(green / count);
    blue = Math.round(blue / count);
    luminance /= count;
    saturation /= count;

    let suggestion;
    if (luminance > 0.68) suggestion = { style: "ambient", tempo: 96, drive: 32, mix: 46, feel: 30, mood: "Bright and spacious" };
    else if (luminance < 0.37 && saturation < 0.2) suggestion = { style: "hardtechno", tempo: 136, drive: 78, mix: 82, feel: 48, mood: "Dark and heavy" };
    else if (saturation > 0.38) suggestion = { style: "metal", tempo: 148, drive: 88, mix: 84, feel: 62, mood: "Bold and high-energy" };
    else suggestion = { style: "industrial", tempo: 126, drive: 64, mix: 70, feel: 42, mood: "Moody and mechanical" };

    return { suggestion, color: `rgb(${red}, ${green}, ${blue})` };
  }

  async function showPhotoOptions(files) {
    elements.photoOptions.replaceChildren();
    for (const file of files) {
      const option = document.createElement("p");
      option.className = "photo-error";
      elements.photoOptions.append(option);
      try {
        const { suggestion, color } = await analyzePhoto(file);
        const card = document.createElement("div");
        card.className = "photo-option";
        const thumbnail = document.createElement("span");
        thumbnail.className = "photo-thumbnail";
        thumbnail.setAttribute("aria-hidden", "true");
        const info = document.createElement("div");
        const title = document.createElement("div");
        title.className = "photo-option-title";
        title.textContent = file.name;
        const details = document.createElement("div");
        details.className = "photo-option-details";
        details.textContent = `${suggestion.mood} · ${styleNames[suggestion.style]} · ${suggestion.tempo} BPM`;
        info.append(title, details);
        const apply = document.createElement("button");
        apply.type = "button";
        apply.textContent = "Use";
        apply.setAttribute("aria-label", `Use studio settings suggested by ${file.name}`);
        apply.addEventListener("click", () => {
          elements.style.value = suggestion.style;
          elements.tempo.value = String(suggestion.tempo);
          elements.drive.value = String(suggestion.drive);
          elements.mix.value = String(suggestion.mix);
          elements.humanize.value = String(suggestion.feel);
          elements.tempo.dispatchEvent(new Event("input", { bubbles: true }));
          elements.drive.dispatchEvent(new Event("input", { bubbles: true }));
          elements.mix.dispatchEvent(new Event("input", { bubbles: true }));
          updateHumanizeFeel();
          if (isPlaying) stopPlayback();
          generateArrangement();
        });
        card.style.setProperty("--photo-color", color);
        card.append(thumbnail, info, apply);
        option.replaceWith(card);
      } catch (error) {
        option.textContent = `${file.name}: ${error.message || "This image could not be read."}`;
      }
    }
  }

  elements.play.addEventListener("click", togglePlayback);
  elements.stop.addEventListener("click", stopPlayback);
  elements.generate.addEventListener("click", generateArrangement);
  elements.generateSecondary.addEventListener("click", generateArrangement);
  elements.tempo.addEventListener("input", updateArrangementTempo);
  elements.drive.addEventListener("input", () => {
    elements.driveValue.value = `${elements.drive.value}%`;
    setWaveShaper();
  });
  elements.mix.addEventListener("input", () => {
    elements.mixValue.value = `${elements.mix.value}%`;
    setWaveShaper();
  });
  elements.humanize.addEventListener("input", updateHumanizeFeel);
  elements.randomSeed.addEventListener("click", randomizeSeed);
  elements.photoInput.addEventListener("change", () => showPhotoOptions(Array.from(elements.photoInput.files || [])));
  elements.style.addEventListener("change", () => {
    if (arrangement && !isPlaying) generateArrangement();
  });

  elements.tempoValue.value = elements.tempo.value;
  elements.driveValue.value = `${elements.drive.value}%`;
  elements.mixValue.value = `${elements.mix.value}%`;
  setHumanizeSummary();
})();
