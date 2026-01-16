console.log("app.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  const recBtn = document.getElementById("recBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const statusText = document.getElementById("statusText");

  if (!recBtn || !stopBtn || !pauseBtn || !statusText) {
    console.error("Missing required elements");
    return;
  }

  // Initial state
  recBtn.disabled = false;
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  statusText.textContent = "Idle";

  // START
  recBtn.onclick = () => {
    console.log("REC clicked");
    statusText.textContent = "REC";
    recBtn.disabled = true;
    stopBtn.disabled = false;
    pauseBtn.disabled = false;
  };

  // PAUSE
  pauseBtn.onclick = () => {
    console.log("PAUSE clicked");
    statusText.textContent = "PAUSE";
    pauseBtn.disabled = true;
    recBtn.disabled = false;
  };

  // STOP
  stopBtn.onclick = () => {
    console.log("STOP clicked");
    statusText.textContent = "STOP";
    stopBtn.disabled = true;
    pauseBtn.disabled = true;
    recBtn.disabled = false;
  };
});
