let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentRepairs = []; // In-memory storage for repairs
let currentRepairIndex = null; // Track which repair is getting parts
let recordingStartTime = null;
let recordingTimerInterval = null;

const jobNotesTextarea = document.getElementById('jobNotes');
const submitBtn = document.getElementById('submitBtn');
const statusMessage = document.getElementById('statusMessage');
const resultsSection = document.getElementById('resultsSection');
const transcriptionSection = document.getElementById('transcriptionSection');
const transcriptionText = document.getElementById('transcriptionText');
const repairGrid = document.getElementById('repairGrid');

// Floating input elements
const floatingInputContainer = document.getElementById('floatingInputContainer');
const floatingMic = document.getElementById('floatingMic');
const recordingIndicator = document.getElementById('recordingIndicator');
const keyboardToggle = document.getElementById('keyboardToggle');
const floatingTextInput = document.getElementById('floatingTextInput');
const floatingTextarea = document.getElementById('floatingTextarea');
const floatingSubmit = document.getElementById('floatingSubmit');

// Parts search modal elements
const partsModal = document.getElementById('partsModal');
const closeModal = document.getElementById('closeModal');
const partsSearchInput = document.getElementById('partsSearchInput');
const partsResults = document.getElementById('partsResults');

// Keyboard mode state
let isKeyboardMode = false;

// Ensure modal is hidden on page load
window.addEventListener('DOMContentLoaded', () => {
  if (partsModal) {
    partsModal.classList.add('hidden');
  }
});

// Push-to-talk functionality
floatingMic.addEventListener('mousedown', startRecording);
floatingMic.addEventListener('mouseup', stopRecording);
floatingMic.addEventListener('mouseleave', (e) => {
  if (isRecording) stopRecording();
});

// Touch support for mobile
floatingMic.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startRecording();
});
floatingMic.addEventListener('touchend', (e) => {
  e.preventDefault();
  stopRecording();
});

submitBtn.addEventListener('click', handleSubmit);
closeModal.addEventListener('click', () => hidePartsModal());
partsModal.addEventListener('click', (e) => {
  if (e.target === partsModal) hidePartsModal();
});

// Keyboard toggle functionality
keyboardToggle.addEventListener('click', toggleKeyboardMode);

// Floating submit button
floatingSubmit.addEventListener('click', handleFloatingSubmit);

// Allow Enter+Shift for new line, Enter alone to submit
floatingTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleFloatingSubmit();
  }
});

// Debounced search
let searchTimeout;
partsSearchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length > 1) {
    searchTimeout = setTimeout(() => searchParts(query), 300);
  } else {
    partsResults.innerHTML = '';
  }
});

function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.classList.add('hidden');
}

function toggleKeyboardMode() {
  isKeyboardMode = !isKeyboardMode;

  if (isKeyboardMode) {
    // Activate keyboard mode
    floatingInputContainer.classList.add('keyboard-mode');
    keyboardToggle.classList.add('active');
    floatingTextInput.classList.remove('hidden');

    // Use setTimeout to ensure transition happens after display change
    setTimeout(() => {
      floatingTextInput.classList.add('visible');
      floatingTextarea.focus();
    }, 10);

    showStatus('Keyboard mode active - Type your notes', 'info');
  } else {
    // Deactivate keyboard mode
    floatingInputContainer.classList.remove('keyboard-mode');
    keyboardToggle.classList.remove('active');
    floatingTextInput.classList.remove('visible');

    setTimeout(() => {
      floatingTextInput.classList.add('hidden');
    }, 300); // Wait for transition to complete

    showStatus('Voice mode active - Hold mic to record', 'info');
  }
}

async function handleFloatingSubmit() {
  const text = floatingTextarea.value.trim();

  if (!text) {
    showStatus('Please enter some text before submitting.', 'error');
    return;
  }

  // Submit the text (same logic as main submit)
  await submitToBackend(null, text);

  // Clear the floating textarea after successful submit
  floatingTextarea.value = '';
}

async function startRecording() {
  if (isRecording) return; // Already recording

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
      await convertAndProcess(audioBlob, true); // true = auto-submit

      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;

    // Visual feedback
    floatingMic.classList.add('recording');
    recordingIndicator.classList.remove('hidden');

    // Start timer
    recordingStartTime = Date.now();
    recordingTimerInterval = setInterval(updateRecordingTimer, 100);

    showStatus('Recording... Release to send', 'info');

  } catch (error) {
    console.error('Error starting recording:', error);
    showStatus('Could not access microphone. Please check permissions.', 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;

  mediaRecorder.stop();
  isRecording = false;

  // Visual feedback
  floatingMic.classList.remove('recording');
  recordingIndicator.classList.add('hidden');

  // Stop timer
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }

  showStatus('Processing audio...', 'info');
}

function updateRecordingTimer() {
  if (!isRecording || !recordingStartTime) return;

  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const timerElement = recordingIndicator.querySelector('.recording-timer');
  if (timerElement) {
    timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

async function convertAndProcess(audioBlob, autoSubmit = false) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    if (autoSubmit) {
      // Auto-submit: transcribe and parse immediately
      await submitToBackend(base64Audio, null);
    } else {
      // Manual mode: just transcribe (not used anymore but keeping for compatibility)
      await submitToBackend(base64Audio, null);
    }

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
    floatingMic.disabled = true;

    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'loading-spinner';
    loadingSpinner.id = 'loadingSpinner';
    document.getElementById('submitText').textContent = 'Processing...';
    submitBtn.appendChild(loadingSpinner);

    // Check if parts modal is open - if so, only transcribe for search
    const isPartsModalOpen = partsModal && !partsModal.classList.contains('hidden');

    if (isPartsModalOpen) {
      showStatus('Transcribing for parts search...', 'info');
    } else {
      showStatus('Processing your notes with AI...', 'info');
    }

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

    // If parts modal is open, populate search field instead of adding repairs
    if (isPartsModalOpen) {
      const searchTerm = result.transcription || text || '';
      partsSearchInput.value = searchTerm;
      partsSearchInput.dispatchEvent(new Event('input'));
      showStatus(`Searching for: "${searchTerm}"`, 'success');
    } else {
      displayResults(result);
    }

  } catch (error) {
    console.error('Error submitting:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    floatingMic.disabled = false;

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

  if (result.repairs && result.repairs.length > 0) {
    // APPEND new repairs to existing ones instead of replacing
    currentRepairs.push(...result.repairs);
    renderRepairs();

    resultsSection.classList.add('visible');

    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    // Clear the input after successful parse
    jobNotesTextarea.value = '';

    showStatus(`Added ${result.repairs.length} new repair(s)! Total: ${currentRepairs.length}`, 'success');
  } else {
    showStatus('No repairs were identified in the notes.', 'error');
  }

  // Show terminology suggestions if any
  if (result.suggestions && result.suggestions.length > 0) {
    showTerminologySuggestions(result.suggestions);
  }

  // Show new term suggestions (add to glossary)
  if (result.newTerms && result.newTerms.length > 0) {
    showNewTermSuggestions(result.newTerms);
  }
}

function showTerminologySuggestions(suggestions) {
  // Remove any existing suggestion UI
  const existingSuggestions = document.getElementById('terminologySuggestions');
  if (existingSuggestions) {
    existingSuggestions.remove();
  }

  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'terminologySuggestions';
  suggestionsContainer.style.cssText = `
    background: #eff6ff;
    border: 2px solid #3b82f6;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  `;

  const title = document.createElement('h3');
  title.textContent = '🤔 Terminology Confirmation';
  title.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 1.1rem;
  `;
  suggestionsContainer.appendChild(title);

  const description = document.createElement('p');
  description.textContent = 'I wasn\'t completely sure about these terms. Please confirm:';
  description.style.cssText = `
    color: #1e40af;
    margin: 0 0 12px 0;
    font-size: 0.9rem;
  `;
  suggestionsContainer.appendChild(description);

  // Track recording state for corrections
  const correctionRecorders = {};

  suggestions.forEach((suggestion, index) => {
    const suggestionItem = document.createElement('div');
    suggestionItem.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #3b82f6;
    `;

    const confidencePercent = Math.round(suggestion.confidence * 100);

    suggestionItem.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong style="color: #1f2937;">I heard:</strong> "<span style="color: #ef4444;">${suggestion.original}</span>"<br>
        <strong style="color: #1f2937;">Did you mean:</strong> "<span style="color: #10b981;">${suggestion.suggested}</span>"?
        <span style="background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px;">${confidencePercent}% match</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-confirm-yes" data-index="${index}" style="background: #10b981; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
          ✓ Yes, correct
        </button>
        <button class="btn-confirm-no" data-index="${index}" style="background: #6b7280; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem; transition: all 0.2s; user-select: none;">
          🎤 Hold to say correction
        </button>
        <div class="recording-status" data-index="${index}" style="display: none; color: #ef4444; font-weight: 600; font-size: 0.9rem;">
          🔴 Recording... <span class="timer">0:00</span>
        </div>
      </div>
    `;

    suggestionsContainer.appendChild(suggestionItem);
  });

  // Add event listeners
  suggestionsContainer.querySelectorAll('.btn-confirm-yes').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      const suggestion = suggestions[index];

      await confirmTerminology(suggestion.original, suggestion.suggested, suggestion.category);

      // Remove this suggestion from the UI
      e.target.closest('div[style*="background: white"]').remove();

      // If no more suggestions, remove the container
      if (suggestionsContainer.querySelectorAll('.btn-confirm-yes').length === 0) {
        suggestionsContainer.remove();
      }
    });
  });

  // Push-to-talk for corrections
  suggestionsContainer.querySelectorAll('.btn-confirm-no').forEach(btn => {
    const index = parseInt(btn.dataset.index);
    const suggestion = suggestions[index];
    const recordingStatus = suggestionsContainer.querySelector(`.recording-status[data-index="${index}"]`);
    const timerElement = recordingStatus.querySelector('.timer');

    let isRecordingCorrection = false;
    let recordingStartTime = null;
    let timerInterval = null;

    const startCorrectionRecording = async () => {
      if (isRecordingCorrection) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        correctionRecorders[index] = {
          mediaRecorder: new MediaRecorder(stream, { mimeType: 'audio/webm' }),
          audioChunks: [],
          stream
        };

        const recorder = correctionRecorders[index];

        recorder.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recorder.audioChunks.push(event.data);
          }
        };

        recorder.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(recorder.audioChunks, { type: 'audio/webm' });
          await processCorrectionAudio(audioBlob, suggestion, index);

          stream.getTracks().forEach(track => track.stop());
          delete correctionRecorders[index];
        };

        recorder.mediaRecorder.start();
        isRecordingCorrection = true;

        // Visual feedback
        btn.style.background = '#ef4444';
        btn.textContent = '🔴 Recording...';
        recordingStatus.style.display = 'block';

        // Timer
        recordingStartTime = Date.now();
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 100);

        showStatus('Recording correction... Release button when done', 'info');

      } catch (error) {
        console.error('Error starting correction recording:', error);
        showStatus('Could not access microphone', 'error');
      }
    };

    const stopCorrectionRecording = () => {
      if (!isRecordingCorrection || !correctionRecorders[index]) return;

      correctionRecorders[index].mediaRecorder.stop();
      isRecordingCorrection = false;

      // Reset visual feedback
      btn.style.background = '#6b7280';
      btn.textContent = '🎤 Hold to say correction';
      recordingStatus.style.display = 'none';

      // Clear timer
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      showStatus('Processing correction...', 'info');
    };

    // Mouse events
    btn.addEventListener('mousedown', startCorrectionRecording);
    btn.addEventListener('mouseup', stopCorrectionRecording);
    btn.addEventListener('mouseleave', () => {
      if (isRecordingCorrection) stopCorrectionRecording();
    });

    // Touch events for mobile
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startCorrectionRecording();
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopCorrectionRecording();
    });
  });

  // Insert before results section
  const container = document.querySelector('.container');
  const resultsSection = document.getElementById('resultsSection');
  container.insertBefore(suggestionsContainer, resultsSection);

  // Scroll to suggestions
  setTimeout(() => {
    suggestionsContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

async function processCorrectionAudio(audioBlob, suggestion, index) {
  try {
    // Convert webm to wav and base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    // Transcribe the correction
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio, text: null })
    });

    if (!response.ok) {
      throw new Error('Failed to transcribe correction');
    }

    const result = await response.json();
    const corrected = result.transcription.trim();

    if (!corrected) {
      showStatus('No correction detected. Please try again.', 'error');
      return;
    }

    // Save the correction
    await confirmTerminology(suggestion.original, corrected, suggestion.category);

    // Remove this suggestion from the UI
    const suggestionElement = document.querySelector(`.btn-confirm-no[data-index="${index}"]`);
    if (suggestionElement) {
      suggestionElement.closest('div[style*="background: white"]').remove();
    }

    // If no more suggestions, remove the container
    const container = document.getElementById('terminologySuggestions');
    if (container && container.querySelectorAll('.btn-confirm-yes').length === 0) {
      container.remove();
    }

  } catch (error) {
    console.error('Error processing correction:', error);
    showStatus(`Error processing correction: ${error.message}`, 'error');
  }
}

async function confirmTerminology(original, corrected, category) {
  try {
    const response = await fetch('/api/terminology/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original, corrected, category })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to save terminology');
    }

    showStatus(`✓ Saved: "${original}" → "${corrected}"`, 'success');

  } catch (error) {
    console.error('Error confirming terminology:', error);
    showStatus(`Error saving terminology: ${error.message}`, 'error');
  }
}

function showNewTermSuggestions(newTerms) {
  // Remove any existing new term UI
  const existingNewTerms = document.getElementById('newTermSuggestions');
  if (existingNewTerms) {
    existingNewTerms.remove();
  }

  const container = document.createElement('div');
  container.id = 'newTermSuggestions';
  container.style.cssText = `
    background: #f0fdf4;
    border: 2px solid #10b981;
    border-radius: 12px;
    padding: 16px;
    margin: 16px 0;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
  `;

  const title = document.createElement('h3');
  title.textContent = '💡 Add to Glossary?';
  title.style.cssText = `
    color: #065f46;
    margin: 0 0 12px 0;
    font-size: 1.1rem;
  `;
  container.appendChild(title);

  const description = document.createElement('p');
  description.textContent = 'I noticed these technical terms that aren\'t in the glossary yet:';
  description.style.cssText = `
    color: #065f46;
    margin: 0 0 12px 0;
    font-size: 0.9rem;
  `;
  container.appendChild(description);

  const newTermRecorders = {};

  newTerms.forEach((termInfo, index) => {
    const termItem = document.createElement('div');
    termItem.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      border-left: 4px solid #10b981;
    `;

    termItem.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong style="color: #1f2937;">Detected:</strong> "<span style="color: #10b981; font-weight: 600;">${termInfo.phrase}</span>"
        ${termInfo.bestMatch ? `<br><small style="color: #6b7280;">Closest match: ${termInfo.bestMatch} (${Math.round(termInfo.similarity * 100)}%)</small>` : ''}
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-add-term-yes" data-index="${index}" style="background: #10b981; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem; transition: all 0.2s; user-select: none;">
          🎤 Hold to confirm
        </button>
        <button class="btn-add-term-no" data-index="${index}" style="background: #6b7280; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
          ✗ Skip
        </button>
        <div class="new-term-recording-status" data-index="${index}" style="display: none; color: #10b981; font-weight: 600; font-size: 0.9rem;">
          🔴 Recording... <span class="timer">0:00</span>
        </div>
      </div>
    `;

    container.appendChild(termItem);
  });

  // Add skip listeners
  container.querySelectorAll('.btn-add-term-no').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('div[style*="background: white"]').remove();
      if (container.querySelectorAll('.btn-add-term-yes').length === 0) {
        container.remove();
      }
    });
  });

  // Add voice recording listeners for confirm
  container.querySelectorAll('.btn-add-term-yes').forEach(btn => {
    const index = parseInt(btn.dataset.index);
    const termInfo = newTerms[index];
    const recordingStatus = container.querySelector(`.new-term-recording-status[data-index="${index}"]`);
    const timerElement = recordingStatus.querySelector('.timer');

    let isRecordingNewTerm = false;
    let recordingStartTime = null;
    let timerInterval = null;

    const startNewTermRecording = async () => {
      if (isRecordingNewTerm) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        newTermRecorders[index] = {
          mediaRecorder: new MediaRecorder(stream, { mimeType: 'audio/webm' }),
          audioChunks: [],
          stream
        };

        const recorder = newTermRecorders[index];

        recorder.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recorder.audioChunks.push(event.data);
          }
        };

        recorder.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(recorder.audioChunks, { type: 'audio/webm' });
          await processNewTermAudio(audioBlob, termInfo, index);

          stream.getTracks().forEach(track => track.stop());
          delete newTermRecorders[index];
        };

        recorder.mediaRecorder.start();
        isRecordingNewTerm = true;

        btn.style.background = '#ef4444';
        btn.textContent = '🔴 Recording...';
        recordingStatus.style.display = 'block';

        recordingStartTime = Date.now();
        timerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 100);

        showStatus('Recording new term... Release when done', 'info');

      } catch (error) {
        console.error('Error starting recording:', error);
        showStatus('Could not access microphone', 'error');
      }
    };

    const stopNewTermRecording = () => {
      if (!isRecordingNewTerm || !newTermRecorders[index]) return;

      newTermRecorders[index].mediaRecorder.stop();
      isRecordingNewTerm = false;

      btn.style.background = '#10b981';
      btn.textContent = '🎤 Hold to confirm';
      recordingStatus.style.display = 'none';

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      showStatus('Processing new term...', 'info');
    };

    btn.addEventListener('mousedown', startNewTermRecording);
    btn.addEventListener('mouseup', stopNewTermRecording);
    btn.addEventListener('mouseleave', () => {
      if (isRecordingNewTerm) stopNewTermRecording();
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startNewTermRecording();
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopNewTermRecording();
    });
  });

  const mainContainer = document.querySelector('.container');
  const resultsSection = document.getElementById('resultsSection');
  mainContainer.insertBefore(container, resultsSection);

  setTimeout(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

async function processNewTermAudio(audioBlob, termInfo, index) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio, text: null })
    });

    if (!response.ok) {
      throw new Error('Failed to transcribe');
    }

    const result = await response.json();
    const confirmed = result.transcription.trim();

    if (!confirmed) {
      showStatus('No term detected. Please try again.', 'error');
      return;
    }

    // Add to glossary
    await fetch('/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        standard_term: confirmed,
        category: 'part_type', // Default category
        variations: [termInfo.phrase],
        description: `Auto-detected from user input`
      })
    });

    showStatus(`✓ Added "${confirmed}" to glossary!`, 'success');

    const termElement = document.querySelector(`.btn-add-term-yes[data-index="${index}"]`);
    if (termElement) {
      termElement.closest('div[style*="background: white"]').remove();
    }

    const newTermContainer = document.getElementById('newTermSuggestions');
    if (newTermContainer && newTermContainer.querySelectorAll('.btn-add-term-yes').length === 0) {
      newTermContainer.remove();
    }

  } catch (error) {
    console.error('Error processing new term:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

function renderRepairs() {
  repairGrid.innerHTML = '';

  currentRepairs.forEach((repair, index) => {
    const repairCard = createRepairCard(repair, index);
    repairGrid.appendChild(repairCard);
  });

  // Add "Add New Repair" button at the end
  const addButton = document.createElement('button');
  addButton.className = 'btn-primary';
  addButton.style.marginTop = '16px';
  addButton.innerHTML = '<span>+ Add New Repair</span>';
  addButton.addEventListener('click', () => addNewRepair());
  repairGrid.appendChild(addButton);

  // Add or update "Submit Final Repairs" button
  let submitFinalBtn = document.getElementById('submitFinalBtn');
  if (!submitFinalBtn) {
    submitFinalBtn = document.createElement('button');
    submitFinalBtn.id = 'submitFinalBtn';
    submitFinalBtn.className = 'btn-secondary';
    submitFinalBtn.style.marginTop = '16px';
    submitFinalBtn.style.width = '100%';
    submitFinalBtn.innerHTML = '<span>✓ Submit Final Repairs</span>';
    submitFinalBtn.addEventListener('click', submitFinalRepairs);
    repairGrid.appendChild(submitFinalBtn);
  }
}

function createRepairCard(repair, index) {
  const card = document.createElement('div');
  card.className = 'repair-card';
  card.dataset.index = index;

  const header = document.createElement('div');
  header.className = 'repair-header';

  const badge = document.createElement('div');
  badge.className = 'equipment-badge';
  badge.textContent = repair.equipment || `Item ${index + 1}`;

  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.gap = '8px';

  const searchPartsBtn = document.createElement('button');
  searchPartsBtn.className = 'btn-primary';
  searchPartsBtn.style.fontSize = '0.85rem';
  searchPartsBtn.style.padding = '6px 12px';
  searchPartsBtn.style.minWidth = 'auto';
  searchPartsBtn.innerHTML = '🔍 Parts';
  searchPartsBtn.addEventListener('click', () => showPartsModal(index));

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.innerHTML = '✏️ Edit';
  editBtn.addEventListener('click', () => editRepair(index));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.innerHTML = '🗑️ Delete';
  deleteBtn.addEventListener('click', () => deleteRepair(index));

  buttonGroup.appendChild(searchPartsBtn);
  buttonGroup.appendChild(editBtn);
  buttonGroup.appendChild(deleteBtn);

  header.appendChild(badge);
  header.appendChild(buttonGroup);
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

  // Display selected parts from database
  if (repair.selectedParts && repair.selectedParts.length > 0) {
    const selectedPartsSection = document.createElement('div');
    selectedPartsSection.className = 'section';
    selectedPartsSection.style.marginTop = '16px';
    selectedPartsSection.style.padding = '12px';
    selectedPartsSection.style.background = '#f0fdf4';
    selectedPartsSection.style.borderRadius = '8px';
    selectedPartsSection.style.border = '2px solid #10b981';

    const hasAutoMatched = repair.selectedParts.some(p => p.auto_matched);
    const selectedPartsTitle = document.createElement('div');
    selectedPartsTitle.className = 'section-title';
    selectedPartsTitle.textContent = hasAutoMatched ? '🤖 AI Auto-Matched Parts' : '✓ Selected Parts from Catalog';
    selectedPartsTitle.style.color = '#10b981';
    selectedPartsSection.appendChild(selectedPartsTitle);

    repair.selectedParts.forEach(part => {
      const partCard = document.createElement('div');
      partCard.style.display = 'flex';
      partCard.style.justifyContent = 'space-between';
      partCard.style.alignItems = 'center';
      partCard.style.padding = '8px';
      partCard.style.background = 'white';
      partCard.style.borderRadius = '6px';
      partCard.style.marginTop = '8px';

      const partInfo = document.createElement('div');
      partInfo.style.flex = '1';

      const typeBadge = document.createElement('span');
      typeBadge.className = part.type === 'consumable' ? 'part-type-consumable' : 'part-type-inventory';
      typeBadge.textContent = part.type === 'consumable' ? 'Consumable' : 'Inventory';
      typeBadge.style.fontSize = '0.7rem';
      typeBadge.style.marginLeft = '8px';

      // Add auto-matched badge if applicable
      let autoMatchBadge = '';
      if (part.auto_matched) {
        const confidence = Math.round(part.match_confidence * 100);
        autoMatchBadge = `<span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;" title="Auto-matched from: ${part.original_text}">🤖 ${confidence}%</span>`;
      }

      partInfo.innerHTML = `<strong>${part.name}</strong> ${typeBadge.outerHTML}${autoMatchBadge}<br>`;

      // Price display
      const priceSpan = document.createElement('span');
      priceSpan.style.fontSize = '0.85rem';
      priceSpan.style.color = '#10b981';
      priceSpan.style.marginRight = '8px';
      priceSpan.textContent = `$${parseFloat(part.price).toFixed(2)} ×`;
      partInfo.appendChild(priceSpan);

      // Quantity controls container
      const qtyControls = document.createElement('span');
      qtyControls.style.display = 'inline-flex';
      qtyControls.style.alignItems = 'center';
      qtyControls.style.gap = '4px';

      // Minus button
      const minusBtn = document.createElement('button');
      minusBtn.textContent = '−';
      minusBtn.style.background = '#ef4444';
      minusBtn.style.color = 'white';
      minusBtn.style.border = 'none';
      minusBtn.style.borderRadius = '4px';
      minusBtn.style.width = '24px';
      minusBtn.style.height = '24px';
      minusBtn.style.cursor = 'pointer';
      minusBtn.style.fontSize = '16px';
      minusBtn.style.lineHeight = '1';
      minusBtn.style.padding = '0';
      minusBtn.addEventListener('click', () => {
        if (part.quantity > 1) {
          part.quantity -= 1;
          renderRepairs();
        } else {
          if (confirm(`Remove ${part.name} from this repair?`)) {
            removePartFromRepair(index, part.part_number);
          }
        }
      });

      // Quantity input
      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.value = part.quantity;
      qtyInput.style.width = '50px';
      qtyInput.style.textAlign = 'center';
      qtyInput.style.border = '1px solid #d1d5db';
      qtyInput.style.borderRadius = '4px';
      qtyInput.style.padding = '4px';
      qtyInput.style.fontSize = '0.85rem';
      qtyInput.addEventListener('change', (e) => {
        const newQty = parseInt(e.target.value);
        if (!isNaN(newQty) && newQty > 0) {
          part.quantity = newQty;
          renderRepairs();
        } else if (newQty === 0) {
          if (confirm(`Remove ${part.name} from this repair?`)) {
            removePartFromRepair(index, part.part_number);
          } else {
            e.target.value = part.quantity;
          }
        } else {
          e.target.value = part.quantity;
        }
      });

      // Plus button
      const plusBtn = document.createElement('button');
      plusBtn.textContent = '+';
      plusBtn.style.background = '#10b981';
      plusBtn.style.color = 'white';
      plusBtn.style.border = 'none';
      plusBtn.style.borderRadius = '4px';
      plusBtn.style.width = '24px';
      plusBtn.style.height = '24px';
      plusBtn.style.cursor = 'pointer';
      plusBtn.style.fontSize = '16px';
      plusBtn.style.lineHeight = '1';
      plusBtn.style.padding = '0';
      plusBtn.addEventListener('click', () => {
        part.quantity += 1;
        renderRepairs();
      });

      qtyControls.appendChild(minusBtn);
      qtyControls.appendChild(qtyInput);
      qtyControls.appendChild(plusBtn);
      partInfo.appendChild(qtyControls);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-delete';
      removeBtn.style.fontSize = '0.75rem';
      removeBtn.style.padding = '4px 8px';
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', () => removePartFromRepair(index, part.part_number));

      partCard.appendChild(partInfo);
      partCard.appendChild(removeBtn);
      selectedPartsSection.appendChild(partCard);
    });

    // Show total price
    const totalPrice = repair.selectedParts.reduce((sum, part) => sum + (parseFloat(part.price) * part.quantity), 0);
    const totalDiv = document.createElement('div');
    totalDiv.style.marginTop = '12px';
    totalDiv.style.fontWeight = '600';
    totalDiv.style.textAlign = 'right';
    totalDiv.style.color = '#10b981';
    totalDiv.textContent = `Parts Total: $${totalPrice.toFixed(2)}`;
    selectedPartsSection.appendChild(totalDiv);

    card.appendChild(selectedPartsSection);
  }

  if (repair.notes) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'notes';
    notesDiv.textContent = repair.notes;
    card.appendChild(notesDiv);
  }

  return card;
}

function editRepair(index) {
  const repair = currentRepairs[index];

  const equipment = prompt('Equipment:', repair.equipment || '');
  if (equipment === null) return; // User cancelled

  const problem = prompt('Problem:', repair.problem || '');
  if (problem === null) return;

  const partsStr = prompt('Parts (comma-separated):', (repair.parts || []).join(', '));
  if (partsStr === null) return;

  const actionsStr = prompt('Actions (comma-separated):', (repair.actions || []).join(', '));
  if (actionsStr === null) return;

  const notes = prompt('Notes:', repair.notes || '');
  if (notes === null) return;

  // Update the repair
  currentRepairs[index] = {
    equipment: equipment.trim(),
    problem: problem.trim(),
    parts: partsStr.split(',').map(p => p.trim()).filter(p => p),
    actions: actionsStr.split(',').map(a => a.trim()).filter(a => a),
    notes: notes.trim()
  };

  renderRepairs();
  showStatus('Repair updated successfully!', 'success');
}

function deleteRepair(index) {
  if (confirm('Are you sure you want to delete this repair?')) {
    currentRepairs.splice(index, 1);
    renderRepairs();
    showStatus('Repair deleted.', 'info');

    if (currentRepairs.length === 0) {
      resultsSection.classList.remove('visible');
    }
  }
}

function addNewRepair() {
  const equipment = prompt('Equipment:', 'RTU-1');
  if (!equipment) return;

  const problem = prompt('Problem:', '');
  if (!problem) return;

  const partsStr = prompt('Parts (comma-separated):', '');
  const actionsStr = prompt('Actions (comma-separated):', '');
  const notes = prompt('Notes (optional):', '');

  const newRepair = {
    equipment: equipment.trim(),
    problem: problem.trim(),
    parts: partsStr.split(',').map(p => p.trim()).filter(p => p),
    actions: actionsStr.split(',').map(a => a.trim()).filter(a => a),
    notes: notes.trim()
  };

  currentRepairs.push(newRepair);
  renderRepairs();
  showStatus('New repair added!', 'success');
}

async function submitFinalRepairs() {
  if (currentRepairs.length === 0) {
    showStatus('No repairs to submit.', 'error');
    return;
  }

  try {
    showStatus('Submitting final repairs...', 'info');

    const response = await fetch('/api/submit-repairs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ repairs: currentRepairs })
    });

    if (!response.ok) {
      throw new Error('Failed to submit repairs');
    }

    const result = await response.json();

    showStatus(`Successfully submitted ${currentRepairs.length} repair(s)!`, 'success');
    console.log('Submitted repairs:', result);

    // Optionally clear the form
    // currentRepairs = [];
    // renderRepairs();

  } catch (error) {
    console.error('Error submitting repairs:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Parts Search Functions
function showPartsModal(repairIndex) {
  currentRepairIndex = repairIndex;
  partsModal.classList.remove('hidden');
  partsSearchInput.value = '';
  partsResults.innerHTML = '<div class="no-results">Start typing to search for parts...</div>';
  partsSearchInput.focus();
}

function hidePartsModal() {
  if (partsModal) {
    partsModal.classList.add('hidden');
  }
  currentRepairIndex = null;
  if (partsSearchInput) {
    partsSearchInput.value = '';
  }
  if (partsResults) {
    partsResults.innerHTML = '';
  }
}

async function searchParts(query) {
  try {
    partsResults.innerHTML = '<div class="no-results">Searching...</div>';

    const response = await fetch(`/api/parts/search?query=${encodeURIComponent(query)}&limit=10`);

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();
    displayPartsResults(data.parts);

  } catch (error) {
    console.error('Parts search error:', error);
    partsResults.innerHTML = '<div class="no-results">Error searching parts. Please try again.</div>';
  }
}

function displayPartsResults(parts) {
  if (parts.length === 0) {
    partsResults.innerHTML = '<div class="no-results">No parts found. Try a different search.</div>';
    return;
  }

  partsResults.innerHTML = '';

  parts.forEach(part => {
    const partItem = document.createElement('div');
    partItem.className = 'part-item';

    const typeBadgeClass = part.type === 'consumable' ? 'part-type-consumable' : 'part-type-inventory';
    const typeLabel = part.type === 'consumable' ? 'Consumable' : 'Inventory';

    partItem.innerHTML = `
      <img src="${part.thumbnail_url}" alt="${part.name}" class="part-thumbnail" />
      <div class="part-info">
        <div class="part-name">${part.name}</div>
        <div class="part-description">${part.description.substring(0, 120)}${part.description.length > 120 ? '...' : ''}</div>
        <div class="part-meta">
          <span class="part-price">$${parseFloat(part.price).toFixed(2)}</span>
          <span class="part-category">${part.category}</span>
          <span class="part-type-badge ${typeBadgeClass}">${typeLabel}</span>
          ${part.similarity ? `<span style="font-size: 0.75rem; color: #6b7280;">${(part.similarity * 100).toFixed(0)}% match</span>` : ''}
        </div>
      </div>
      <button class="btn-add-part">Add Part</button>
    `;

    partItem.querySelector('.btn-add-part').addEventListener('click', (e) => {
      e.stopPropagation();
      addPartToRepair(part);
    });

    partsResults.appendChild(partItem);
  });
}

function addPartToRepair(part) {
  if (currentRepairIndex === null) {
    showStatus('Please select a repair first by clicking "🔍 Parts" on a repair card.', 'error');
    return;
  }

  const repair = currentRepairs[currentRepairIndex];

  // Initialize selectedParts array if it doesn't exist
  if (!repair.selectedParts) {
    repair.selectedParts = [];
  }

  // Check if part already added
  const existingPart = repair.selectedParts.find(p => p.part_number === part.part_number);
  if (existingPart) {
    // Auto-increase quantity by 1
    existingPart.quantity += 1;
    renderRepairs();
    showStatus(`Increased ${part.name} quantity to ${existingPart.quantity}`, 'success');
    return;
  }

  // Add part with default quantity of 1
  repair.selectedParts.push({
    part_number: part.part_number,
    name: part.name,
    price: part.price,
    type: part.type,
    quantity: 1
  });

  renderRepairs();
  hidePartsModal();
  showStatus(`Added ${part.name} to repair!`, 'success');
}

function removePartFromRepair(repairIndex, partNumber) {
  const repair = currentRepairs[repairIndex];
  if (!repair.selectedParts) return;

  repair.selectedParts = repair.selectedParts.filter(p => p.part_number !== partNumber);
  renderRepairs();
  showStatus('Part removed from repair.', 'info');
}
