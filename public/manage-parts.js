let allParts = [];
let currentEditingPart = null;

// Load parts on page load
document.addEventListener('DOMContentLoaded', () => {
  loadParts();
  loadCategories();

  // Search and filter event listeners
  document.getElementById('searchBox').addEventListener('input', filterParts);
  document.getElementById('categoryFilter').addEventListener('change', filterParts);
  document.getElementById('typeFilter').addEventListener('change', filterParts);

  // Form submit handler
  document.getElementById('partForm').addEventListener('submit', handlePartSubmit);
});

// Load all parts from API
async function loadParts() {
  try {
    showLoading();

    const response = await fetch('/api/parts/all');
    if (!response.ok) throw new Error('Failed to load parts');

    allParts = await response.json();
    renderPartsTable(allParts);

  } catch (error) {
    console.error('Error loading parts:', error);
    showError('Failed to load parts. Please refresh the page.');
  }
}

// Load categories for filter dropdown
async function loadCategories() {
  try {
    const response = await fetch('/api/parts/categories');
    if (!response.ok) return;

    const data = await response.json();
    const categoryFilter = document.getElementById('categoryFilter');

    data.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.category;
      option.textContent = `${cat.category} (${cat.count})`;
      categoryFilter.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

// Render parts table
function renderPartsTable(parts) {
  const container = document.getElementById('partsTableContainer');

  if (parts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
        </svg>
        <h3>No parts found</h3>
        <p>Add your first part to get started!</p>
      </div>
    `;
    return;
  }

  const table = `
    <div class="parts-table">
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>Name</th>
            <th>Category</th>
            <th>Type</th>
            <th style="text-align: right;">Price</th>
            <th style="text-align: center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${parts.map(part => `
            <tr>
              <td><strong>${part.part_number}</strong></td>
              <td>${part.name}</td>
              <td>${part.category}</td>
              <td>
                <span class="part-type-badge part-type-${part.type}">
                  ${part.type === 'consumable' ? 'Consumable' : 'Inventory'}
                </span>
              </td>
              <td style="text-align: right;">$${parseFloat(part.price).toFixed(2)}</td>
              <td style="text-align: center;">
                <div class="action-buttons">
                  <button class="btn-icon btn-edit" onclick="editPart(${part.id})">✏️ Edit</button>
                  <button class="btn-icon btn-delete" onclick="deletePart(${part.id}, '${part.name}')">🗑️</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = table;
}

// Filter parts based on search and filters
function filterParts() {
  const searchTerm = document.getElementById('searchBox').value.toLowerCase();
  const categoryFilter = document.getElementById('categoryFilter').value;
  const typeFilter = document.getElementById('typeFilter').value;

  const filtered = allParts.filter(part => {
    const matchesSearch = !searchTerm ||
      part.name.toLowerCase().includes(searchTerm) ||
      part.part_number.toLowerCase().includes(searchTerm) ||
      (part.description && part.description.toLowerCase().includes(searchTerm));

    const matchesCategory = !categoryFilter || part.category === categoryFilter;
    const matchesType = !typeFilter || part.type === typeFilter;

    return matchesSearch && matchesCategory && matchesType;
  });

  renderPartsTable(filtered);
}

// Show add part modal
function showAddPartModal() {
  currentEditingPart = null;
  document.getElementById('modalTitle').textContent = 'Add New Part';
  document.getElementById('partForm').reset();
  document.getElementById('partId').value = '';
  document.getElementById('terminologyMatchesSection').style.display = 'none';
  document.getElementById('partModal').classList.add('visible');
}

// Edit part
async function editPart(partId) {
  const part = allParts.find(p => p.id === partId);
  if (!part) return;

  currentEditingPart = part;
  document.getElementById('modalTitle').textContent = 'Edit Part';
  document.getElementById('partId').value = part.id;
  document.getElementById('partNumber').value = part.part_number;
  document.getElementById('partName').value = part.name;
  document.getElementById('partDescription').value = part.description || '';
  document.getElementById('partCategory').value = part.category;
  document.querySelector(`input[name="partType"][value="${part.type}"]`).checked = true;
  document.getElementById('partPrice').value = parseFloat(part.price).toFixed(2);

  // Load terminology matches
  await loadTerminologyMatches(part.name);

  document.getElementById('partModal').classList.add('visible');
}

// Load terminology matches for a part name
async function loadTerminologyMatches(partName) {
  try {
    const response = await fetch('/api/terminology/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: partName })
    });

    if (!response.ok) {
      document.getElementById('terminologyMatchesSection').style.display = 'none';
      return;
    }

    const data = await response.json();

    if (data.matches && data.matches.length > 0) {
      const matchesList = document.getElementById('terminologyMatchesList');
      matchesList.innerHTML = data.matches
        .slice(0, 5) // Show top 5 matches
        .map(match => `
          <li>${match.standard_term} (${Math.round(match.similarity * 100)}% match)</li>
        `)
        .join('');

      document.getElementById('terminologyMatchesSection').style.display = 'block';
    } else {
      document.getElementById('terminologyMatchesSection').style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading terminology matches:', error);
    document.getElementById('terminologyMatchesSection').style.display = 'none';
  }
}

// Hide modal
function hidePartModal() {
  document.getElementById('partModal').classList.remove('visible');
  currentEditingPart = null;
}

// Handle form submit (add or edit)
async function handlePartSubmit(e) {
  e.preventDefault();

  const partData = {
    part_number: document.getElementById('partNumber').value.trim(),
    name: document.getElementById('partName').value.trim(),
    description: document.getElementById('partDescription').value.trim(),
    category: document.getElementById('partCategory').value,
    type: document.querySelector('input[name="partType"]:checked').value,
    price: parseFloat(document.getElementById('partPrice').value),
    thumbnail_url: 'https://via.placeholder.com/150?text=' + encodeURIComponent(document.getElementById('partName').value.substring(0, 10)),
    common_uses: []
  };

  try {
    const partId = document.getElementById('partId').value;
    const isEditing = !!partId;

    const url = isEditing ? `/api/parts/${partId}` : '/api/parts';
    const method = isEditing ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save part');
    }

    const result = await response.json();

    showStatus(isEditing ? 'Part updated successfully!' : 'Part added successfully!', 'success');
    hidePartModal();
    await loadParts(); // Reload parts list

  } catch (error) {
    console.error('Error saving part:', error);
    showStatus(error.message, 'error');
  }
}

// Delete part
async function deletePart(partId, partName) {
  if (!confirm(`Are you sure you want to delete "${partName}"?\n\nThis will remove it from the catalog and it won't be available for auto-matching.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/parts/${partId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete part');
    }

    showStatus('Part deleted successfully.', 'success');
    await loadParts(); // Reload parts list

  } catch (error) {
    console.error('Error deleting part:', error);
    showStatus(error.message, 'error');
  }
}

// Helper functions
function showLoading() {
  document.getElementById('partsTableContainer').innerHTML = '<div class="loading">Loading parts...</div>';
}

function showError(message) {
  document.getElementById('partsTableContainer').innerHTML = `
    <div class="empty-state">
      <h3>Error</h3>
      <p>${message}</p>
    </div>
  `;
}

function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  statusEl.classList.remove('hidden');

  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 3000);
}
