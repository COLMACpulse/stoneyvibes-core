console.log("app.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM ready");

  const recBtn = document.getElementById("recBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusText = document.getElementById("statusText");

  if (!recBtn || !stopBtn || !statusText) {
    console.error("Required UI elements missing");
    return;
  }

  let isRecording = false;

  recBtn.onclick = () => {
    if (isRecording) return;
    isRecording = true;

    recBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = "Recording…";

    console.log("REC pressed");
  };

  stopBtn.onclick = () => {
    if (!isRecording) return;
    isRecording = false;

    recBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Idle";

    console.log("STOP pressed");
  };
});
