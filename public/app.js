let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentRepairs = []; // In-memory storage for repairs
let partsStatus = {}; // Cache for parts existence status

// Modal variables
let modalMediaRecorder = null;
let modalAudioChunks = [];
let isModalRecording = false;
let currentPartToAdd = '';

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

// Modal elements
const addPartModal = document.getElementById('addPartModal');
const modalRecordBtn = document.getElementById('modalRecordBtn');
const modalRecordIcon = document.getElementById('modalRecordIcon');
const modalRecordText = document.getElementById('modalRecordText');
const addPartForm = document.getElementById('addPartForm');

recordBtn.addEventListener('click', toggleRecording);
submitBtn.addEventListener('click', handleSubmit);
modalRecordBtn.addEventListener('click', toggleModalRecording);
addPartForm.addEventListener('submit', handleAddPart);

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

  if (result.repairs && result.repairs.length > 0) {
    // Store repairs in memory
    currentRepairs = result.repairs;
    renderRepairs();

    resultsSection.classList.add('visible');

    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } else {
    showStatus('No repairs were identified in the notes.', 'error');
  }
}

async function renderRepairs() {
  repairGrid.innerHTML = '';

  // Check all parts against database
  await checkPartsInDatabase();

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

async function checkPartsInDatabase() {
  // Collect all unique parts from all repairs
  const allParts = new Set();
  currentRepairs.forEach(repair => {
    if (repair.parts && repair.parts.length > 0) {
      repair.parts.forEach(part => allParts.add(part));
    }
  });

  if (allParts.size === 0) return;

  try {
    const response = await fetch('/api/parts/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ parts: Array.from(allParts) })
    });

    if (response.ok) {
      const data = await response.json();
      partsStatus = {};
      data.results.forEach(result => {
        partsStatus[result.part] = result.exists;
      });
    }
  } catch (error) {
    console.error('Error checking parts:', error);
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

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.innerHTML = '✏️ Edit';
  editBtn.addEventListener('click', () => editRepair(index));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.innerHTML = '🗑️ Delete';
  deleteBtn.addEventListener('click', () => deleteRepair(index));

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
      const partWrapper = document.createElement('div');
      partWrapper.className = 'part-item-wrapper';

      const partItem = document.createElement('span');
      partItem.className = 'list-item';

      // Check if part is in database
      const isInDatabase = partsStatus[part];
      if (isInDatabase === false) {
        partItem.classList.add('part-not-in-database');
      }

      partItem.textContent = part;
      partWrapper.appendChild(partItem);

      // Add "Not in DB" badge and button if part is not in database
      if (isInDatabase === false) {
        const badge = document.createElement('span');
        badge.className = 'not-in-db-badge';
        badge.textContent = 'Not in DB';
        partWrapper.appendChild(badge);

        const addBtn = document.createElement('button');
        addBtn.className = 'add-part-btn';
        addBtn.textContent = '+ Add';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAddPartModal(part);
        });
        partWrapper.appendChild(addBtn);
      }

      partsList.appendChild(partWrapper);
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

// ========== ADD PART MODAL FUNCTIONS ==========

function openAddPartModal(partName) {
  currentPartToAdd = partName;
  document.getElementById('partName').value = partName;
  addPartModal.classList.remove('hidden');

  // Clear other fields
  document.getElementById('partNumber').value = '';
  document.getElementById('partCategory').value = '';
  document.getElementById('partType').value = '';
  document.getElementById('partPrice').value = '';
  document.getElementById('partDescription').value = '';
  document.getElementById('partCommonUses').value = '';
}

function closeAddPartModal() {
  addPartModal.classList.add('hidden');
  currentPartToAdd = '';

  // Stop recording if active
  if (isModalRecording) {
    stopModalRecording();
  }
}

async function toggleModalRecording() {
  if (isModalRecording) {
    stopModalRecording();
  } else {
    await startModalRecording();
  }
}

async function startModalRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStatus('Voice recording is not supported in this browser.', 'error');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    modalMediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm'
    });

    modalAudioChunks = [];

    modalMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        modalAudioChunks.push(event.data);
      }
    };

    modalMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(modalAudioChunks, { type: 'audio/webm' });
      await processModalAudio(audioBlob);

      stream.getTracks().forEach(track => track.stop());
    };

    modalMediaRecorder.start();
    isModalRecording = true;

    modalRecordBtn.classList.add('recording');
    modalRecordIcon.textContent = '⏹️';
    modalRecordText.textContent = 'Stop Recording';
    showStatus('Recording part details... Click "Stop Recording" when finished.', 'info');

  } catch (error) {
    console.error('Error starting modal recording:', error);
    showStatus('Could not access microphone. Please check permissions.', 'error');
  }
}

function stopModalRecording() {
  if (modalMediaRecorder && isModalRecording) {
    modalMediaRecorder.stop();
    isModalRecording = false;

    modalRecordBtn.classList.remove('recording');
    modalRecordIcon.textContent = '🎤';
    modalRecordText.textContent = 'Hold to Record';
    showStatus('Processing audio...', 'info');
  }
}

async function processModalAudio(audioBlob) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBlob = await audioBufferToWav(audioBuffer);
    const base64Audio = await blobToBase64(wavBlob);

    // Send to backend to parse part details
    showStatus('Extracting part details from audio...', 'info');

    const response = await fetch('/api/parts/parse-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio: base64Audio,
        partName: currentPartToAdd
      })
    });

    if (!response.ok) {
      throw new Error('Failed to parse part details');
    }

    const result = await response.json();

    // Fill form with extracted details
    if (result.partDetails) {
      document.getElementById('partName').value = result.partDetails.name || currentPartToAdd;
      document.getElementById('partNumber').value = result.partDetails.part_number || '';
      document.getElementById('partCategory').value = result.partDetails.category || '';
      document.getElementById('partType').value = result.partDetails.type || '';
      document.getElementById('partPrice').value = result.partDetails.price || '';
      document.getElementById('partDescription').value = result.partDetails.description || '';
      document.getElementById('partCommonUses').value = result.partDetails.common_uses || '';

      showStatus('Part details extracted! Review and edit as needed.', 'success');
    }

  } catch (error) {
    console.error('Error processing modal audio:', error);
    showStatus('Error processing audio. Please fill in the fields manually.', 'error');
  }
}

async function handleAddPart(e) {
  e.preventDefault();

  const partData = {
    name: document.getElementById('partName').value.trim(),
    part_number: document.getElementById('partNumber').value.trim(),
    category: document.getElementById('partCategory').value,
    type: document.getElementById('partType').value,
    price: parseFloat(document.getElementById('partPrice').value) || 0,
    description: document.getElementById('partDescription').value.trim(),
    common_uses: document.getElementById('partCommonUses').value.trim()
  };

  if (!partData.name || !partData.category || !partData.type) {
    showStatus('Please fill in all required fields (Name, Category, Type).', 'error');
    return;
  }

  try {
    showStatus('Adding part to database...', 'info');

    const response = await fetch('/api/parts/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(partData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add part');
    }

    const result = await response.json();

    showStatus(`Successfully added "${partData.name}" to parts database!`, 'success');

    // Update parts status cache
    partsStatus[currentPartToAdd] = true;

    // Close modal
    closeAddPartModal();

    // Re-render repairs to update UI
    await renderRepairs();

  } catch (error) {
    console.error('Error adding part:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}
