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

  recBtn.onclick = () => {
    console.log("REC clicked");
    statusText.textContent = "REC";
  };

  stopBtn.onclick = () => {
    console.log("STOP clicked");
    statusText.textContent = "STOP";
  };

  pauseBtn.onclick = () => {
    console.log("PAUSE clicked");
    statusText.textContent = "PAUSE";
  };
});
