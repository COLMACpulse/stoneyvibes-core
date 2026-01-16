console.log("app.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const recBtn = document.getElementById("recBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusText = document.getElementById("statusText");
  const preview = document.getElementById("preview");

  if (!recBtn || !stopBtn || !statusText || !preview) {
    console.error("Missing required elements");
    return;
  }

  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];

  recBtn.onclick = async () => {
    if (mediaRecorder) return;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("Mic permission denied");
      return;
    }

    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      preview.src = URL.createObjectURL(blob);
      preview.style.display = "block";

      mediaStream.getTracks().forEach(t => t.stop());
      mediaRecorder = null;
      mediaStream = null;
      chunks = [];
    };

    mediaRecorder.start();
    recBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = "Recording…";

    console.log("Recording started");
  };

  stopBtn.onclick = () => {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    recBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Idle";

    console.log("Recording stopped");
  };
});
