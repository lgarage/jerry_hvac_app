/**
 * Filter size lookup utility
 * Uses filter-sizes.json for smart suggestions and validation
 */

const fs = require('fs');
const path = require('path');

let filterData = null;

/**
 * Load filter sizes from JSON file
 */
function loadFilterSizes() {
  if (filterData) return filterData;

  try {
    const filePath = path.join(__dirname, '..', 'data', 'filter-sizes.json');
    const rawData = fs.readFileSync(filePath, 'utf8');
    filterData = JSON.parse(rawData);
    return filterData;
  } catch (error) {
    console.error('Error loading filter sizes:', error);
    return { filters: [], metadata: {} };
  }
}

/**
 * Get popular filter sizes for suggestions
 */
function getPopularFilterSizes() {
  const data = loadFilterSizes();
  return data.filters
    .filter(f => f.popular)
    .map(f => f.size);
}

/**
 * Get all filter sizes
 */
function getAllFilterSizes() {
  const data = loadFilterSizes();
  return data.filters.map(f => f.size);
}

/**
 * Validate if a filter size exists in inventory
 * @param {string} sizeString - e.g., "24x24x2", "20 by 25 by 1"
 * @returns {Object|null} Filter object if found, null otherwise
 */
function validateFilterSize(sizeString) {
  const data = loadFilterSizes();
  const normalized = normalizeFilterSize(sizeString);

  return data.filters.find(filter => {
    // Check exact size match
    if (filter.size === normalized) return true;

    // Check common name variants
    if (filter.commonNames && filter.commonNames.some(name =>
      name.toLowerCase() === sizeString.toLowerCase()
    )) {
      return true;
    }

    return false;
  }) || null;
}

/**
 * Normalize filter size string to standard format
 * @param {string} sizeString - e.g., "24 by 24 by 2", "24×24×2"
 * @returns {string} Normalized size - e.g., "24x24x2"
 */
function normalizeFilterSize(sizeString) {
  if (!sizeString) return '';

  // Extract dimensions
  const pattern = /(\d{1,2})\s*([xX×]|by)\s*(\d{1,2})\s*([xX×]|by)\s*(\d{1,2})/i;
  const match = sizeString.match(pattern);

  if (match) {
    return `${match[1]}x${match[3]}x${match[5]}`;
  }

  // Already in correct format?
  if (/^\d{1,2}x\d{1,2}x\d{1,2}$/i.test(sizeString)) {
    return sizeString.toLowerCase();
  }

  return sizeString.toLowerCase();
}

/**
 * Get pricing for a filter size
 * @param {string} sizeString - Filter size
 * @param {number} quantity - Quantity needed
 * @returns {Object} Pricing info { size, quantity, unitPrice, total, tier }
 */
function getFilterPricing(sizeString, quantity = 1) {
  const filter = validateFilterSize(sizeString);

  if (!filter) {
    return {
      size: sizeString,
      quantity: quantity,
      found: false,
      message: 'Filter size not found in inventory'
    };
  }

  // Determine pricing tier based on quantity
  let tier = filter.pricing.tier1;
  let tierName = 'tier1';

  if (quantity >= filter.pricing.tier3.qty) {
    tier = filter.pricing.tier3;
    tierName = 'tier3';
  } else if (quantity >= filter.pricing.tier2.qty) {
    tier = filter.pricing.tier2;
    tierName = 'tier2';
  }

  return {
    size: filter.size,
    quantity: quantity,
    found: true,
    unitPrice: tier.price,
    total: (tier.price * quantity).toFixed(2),
    tier: tierName,
    qtyPerCase: filter.qtyPerCase,
    merv: filter.merv,
    pricing: filter.pricing
  };
}

/**
 * Get filter size suggestions based on equipment history
 * @param {string} equipmentId - Equipment ID (e.g., "RTU-6")
 * @param {Array} history - Previous filter sizes used for this equipment
 * @returns {Array<string>} Suggested filter sizes
 */
function getSuggestedFilterSizes(equipmentId = null, history = []) {
  // If we have history for this equipment, suggest most recent
  if (history && history.length > 0) {
    return history.slice(0, 3); // Return top 3 most recent
  }

  // Otherwise, return popular sizes
  return getPopularFilterSizes();
}

/**
 * Search filters by dimensions (fuzzy match)
 * @param {number} width - Width in inches
 * @param {number} height - Height in inches
 * @param {number} depth - Depth in inches (optional)
 * @returns {Array} Matching filters
 */
function searchFiltersByDimensions(width, height, depth = null) {
  const data = loadFilterSizes();

  return data.filters.filter(filter => {
    const widthMatch = filter.width === width;
    const heightMatch = filter.height === height;
    const depthMatch = depth === null || filter.depth === depth;

    return widthMatch && heightMatch && depthMatch;
  });
}

/**
 * Get filters within a price range
 * @param {number} minPrice - Minimum price
 * @param {number} maxPrice - Maximum price
 * @returns {Array} Filters within price range
 */
function getFiltersByPriceRange(minPrice, maxPrice) {
  const data = loadFilterSizes();

  return data.filters.filter(filter => {
    const price = filter.pricing.tier1.price;
    return price >= minPrice && price <= maxPrice;
  });
}

module.exports = {
  loadFilterSizes,
  getPopularFilterSizes,
  getAllFilterSizes,
  validateFilterSize,
  normalizeFilterSize,
  getFilterPricing,
  getSuggestedFilterSizes,
  searchFiltersByDimensions,
  getFiltersByPriceRange
};
