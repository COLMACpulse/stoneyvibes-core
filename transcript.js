export function createTranscriptEngine(onUpdate, onStatus){
  let recognition = null;
  let isRecording = false;

  function supported(){
    return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  }

  function start(){
    if(!supported()){
      onStatus && onStatus("unsupported");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isRecording = true;
      onStatus && onStatus("recording");
    };

    recognition.onend = () => {
      isRecording = false;
      onStatus && onStatus("stopped");
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      onUpdate && onUpdate(transcript);
    };

    recognition.start();
  }

  function stop(){
    if(recognition && isRecording){
      recognition.stop();
    }
  }

  return { start, stop, supported };
}
