let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

const jobNotesTextarea = document.getElementById('jobNotes');
const recordBtn = document.getElementById('recordBtn');
const submitBtn = document.getElementById('submitBtn');
const statusMessage = document.getElementById('statusMessage');
const resultsSection = document.getElementById('resultsSection');
const transcriptionSection = document.getElementById('transcriptionSection');
const transcriptionText = document.getElementById('transcriptionText');
const repairGrid = document.getElementById('repairGrid');
const recordIcon = document.getElementById('recordIcon');
const recordText = document.getElementById('recordText');

recordBtn.addEventListener('click', toggleRecording);
submitBtn.addEventListener('click', handleSubmit);

function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.classList.add('hidden');
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStatus('Voice recording is not supported in this browser. Please type your notes instead.', 'error');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      await convertAndProcess(audioBlob);

      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;

    recordBtn.classList.add('recording');
    recordIcon.textContent = '⏹️';
    recordText.textContent = 'Stop Recording';
    showStatus('Recording... Click "Stop Recording" when finished.', 'info');

  } catch (error) {
    console.error('Error starting recording:', error);
    showStatus('Could not access microphone. Please check permissions.', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;

    recordBtn.classList.remove('recording');
    recordIcon.textContent = '🎤';
    recordText.textContent = 'Record Voice';
    showStatus('Processing audio...', 'info');
  }
}

async function convertAndProcess(audioBlob) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    await submitToBackend(base64Audio, null);

  } catch (error) {
    console.error('Error converting audio:', error);
    showStatus('Error processing audio. Please try typing your notes instead.', 'error');
  }
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;

  const data = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    data.push(audioBuffer.getChannelData(i));
  }

  const interleaved = interleave(data);
  const dataLength = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  floatTo16BitPCM(view, 44, interleaved);

  return new Blob([view], { type: 'audio/wav' });
}

function interleave(channelData) {
  const length = channelData[0].length;
  const result = new Float32Array(length * channelData.length);

  let offset = 0;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < channelData.length; channel++) {
      result[offset++] = channelData[channel][i];
    }
  }

  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleSubmit() {
  const text = jobNotesTextarea.value.trim();

  if (!text) {
    showStatus('Please enter or record job notes before submitting.', 'error');
    return;
  }

  await submitToBackend(null, text);
}

async function submitToBackend(audio, text) {
  try {
    submitBtn.disabled = true;
    recordBtn.disabled = true;

    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'loading-spinner';
    loadingSpinner.id = 'loadingSpinner';
    document.getElementById('submitText').textContent = 'Processing...';
    submitBtn.appendChild(loadingSpinner);

    showStatus('Processing your notes with AI...', 'info');

    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ audio, text })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to process notes');
    }

    const result = await response.json();

    displayResults(result);
    showStatus('Successfully parsed repair items!', 'success');

  } catch (error) {
    console.error('Error submitting:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    recordBtn.disabled = false;

    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.remove();
    document.getElementById('submitText').textContent = 'Parse Notes';
  }
}

function displayResults(result) {
  if (result.transcription && result.transcription !== jobNotesTextarea.value.trim()) {
    transcriptionText.textContent = result.transcription;
    transcriptionSection.classList.remove('hidden');
  } else {
    transcriptionSection.classList.add('hidden');
  }

  repairGrid.innerHTML = '';

  if (result.repairs && result.repairs.length > 0) {
    result.repairs.forEach((repair, index) => {
      const repairCard = createRepairCard(repair, index + 1);
      repairGrid.appendChild(repairCard);
    });

    resultsSection.classList.add('visible');

    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } else {
    showStatus('No repairs were identified in the notes.', 'error');
  }
}

function createRepairCard(repair, index) {
  const card = document.createElement('div');
  card.className = 'repair-card';

  const header = document.createElement('div');
  header.className = 'repair-header';

  const badge = document.createElement('div');
  badge.className = 'equipment-badge';
  badge.textContent = repair.equipment || `Item ${index}`;

  header.appendChild(badge);
  card.appendChild(header);

  const problem = document.createElement('div');
  problem.className = 'problem';
  problem.textContent = repair.problem || 'No problem description';
  card.appendChild(problem);

  if (repair.parts && repair.parts.length > 0) {
    const partsSection = document.createElement('div');
    partsSection.className = 'section';

    const partsTitle = document.createElement('div');
    partsTitle.className = 'section-title';
    partsTitle.textContent = 'Parts Needed';
    partsSection.appendChild(partsTitle);

    const partsList = document.createElement('div');
    partsList.className = 'list-items';
    repair.parts.forEach(part => {
      const partItem = document.createElement('span');
      partItem.className = 'list-item';
      partItem.textContent = part;
      partsList.appendChild(partItem);
    });

    partsSection.appendChild(partsList);
    card.appendChild(partsSection);
  }

  if (repair.actions && repair.actions.length > 0) {
    const actionsSection = document.createElement('div');
    actionsSection.className = 'section';

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'section-title';
    actionsTitle.textContent = 'Actions';
    actionsSection.appendChild(actionsTitle);

    const actionsList = document.createElement('div');
    actionsList.className = 'list-items';
    repair.actions.forEach(action => {
      const actionItem = document.createElement('span');
      actionItem.className = 'list-item';
      actionItem.textContent = action;
      actionsList.appendChild(actionItem);
    });

    actionsSection.appendChild(actionsList);
    card.appendChild(actionsSection);
  }

  if (repair.notes) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'notes';
    notesDiv.textContent = repair.notes;
    card.appendChild(notesDiv);
  }

  return card;
}
