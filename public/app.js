let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentRepairs = []; // In-memory storage for repairs
let currentRepairIndex = null; // Track which repair is getting parts

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

// Parts search modal elements
const partsModal = document.getElementById('partsModal');
const closeModal = document.getElementById('closeModal');
const partsSearchInput = document.getElementById('partsSearchInput');
const partsResults = document.getElementById('partsResults');

// Ensure modal is hidden on page load
window.addEventListener('DOMContentLoaded', () => {
  if (partsModal) {
    partsModal.classList.add('hidden');
  }
});

recordBtn.addEventListener('click', toggleRecording);
submitBtn.addEventListener('click', handleSubmit);
closeModal.addEventListener('click', () => hidePartsModal());
partsModal.addEventListener('click', (e) => {
  if (e.target === partsModal) hidePartsModal();
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

    const selectedPartsTitle = document.createElement('div');
    selectedPartsTitle.className = 'section-title';
    selectedPartsTitle.textContent = '✓ Selected Parts from Catalog';
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

      partInfo.innerHTML = `<strong>${part.name}</strong> ${typeBadge.outerHTML}<br>`;

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
