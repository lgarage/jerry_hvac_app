/**
 * Extract HVAC unit identifiers from text
 *
 * Matches patterns like:
 *   RTU-1, RTU-6, RTU-12
 *   AHU-1, AHU-2
 *   FCU-1, FCU-3
 *   MAU-1
 *   "rooftop unit 6" → RTU-6
 *   "air handler 2" → AHU-2
 *
 * @param {string} text - Text to extract units from
 * @returns {Array<string>} Array of unit identifiers (e.g., ["RTU-6", "RTU-2"])
 */
export function extractUnits(text) {
  if (!text) return [];

  const units = [];
  const seenUnits = new Set();

  // Normalize text to uppercase for matching
  const normalizedText = text.toUpperCase();

  // Pattern 1: Direct unit codes with dash (RTU-1, AHU-2, FCU-3, MAU-1)
  const directPattern = /\b(RTU|AHU|FCU|MAU)-(\d+)\b/gi;
  let match;
  while ((match = directPattern.exec(text)) !== null) {
    const unit = `${match[1].toUpperCase()}-${match[2]}`;
    if (!seenUnits.has(unit)) {
      units.push(unit);
      seenUnits.add(unit);
    }
  }

  // Pattern 2: Unit codes without dash (RTU1, AHU2 → RTU-1, AHU-2)
  const noDashPattern = /\b(RTU|AHU|FCU|MAU)(\d+)\b/gi;
  while ((match = noDashPattern.exec(text)) !== null) {
    const unit = `${match[1].toUpperCase()}-${match[2]}`;
    if (!seenUnits.has(unit)) {
      units.push(unit);
      seenUnits.add(unit);
    }
  }

  // Pattern 3: Long-form descriptions
  const longFormPatterns = [
    { pattern: /\brooftop\s+unit\s+(\d+)\b/gi, prefix: 'RTU' },
    { pattern: /\bRTU\s+(\d+)\b/gi, prefix: 'RTU' },
    { pattern: /\bair\s+handler\s+(\d+)\b/gi, prefix: 'AHU' },
    { pattern: /\bAHU\s+(\d+)\b/gi, prefix: 'AHU' },
    { pattern: /\bfan\s+coil\s+unit\s+(\d+)\b/gi, prefix: 'FCU' },
    { pattern: /\bFCU\s+(\d+)\b/gi, prefix: 'FCU' },
    { pattern: /\bmakeup\s+air\s+unit\s+(\d+)\b/gi, prefix: 'MAU' },
    { pattern: /\bMAU\s+(\d+)\b/gi, prefix: 'MAU' }
  ];

  for (const { pattern, prefix } of longFormPatterns) {
    pattern.lastIndex = 0; // Reset regex state
    while ((match = pattern.exec(text)) !== null) {
      const unit = `${prefix}-${match[1]}`;
      if (!seenUnits.has(unit)) {
        units.push(unit);
        seenUnits.add(unit);
      }
    }
  }

  // Sort units for consistent ordering (RTU-1, RTU-2, ... AHU-1, AHU-2, ...)
  return units.sort((a, b) => {
    const [prefixA, numA] = a.split('-');
    const [prefixB, numB] = b.split('-');

    // Sort by prefix first
    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB);
    }

    // Then by number
    return parseInt(numA) - parseInt(numB);
  });
}

/**
 * Check if text mentions a specific unit
 *
 * @param {string} text - Text to search
 * @param {string} unitId - Unit identifier (e.g., "RTU-6")
 * @returns {boolean} True if unit is mentioned
 */
export function mentionsUnit(text, unitId) {
  if (!text || !unitId) return false;

  const units = extractUnits(text);
  return units.includes(unitId);
}

/**
 * Group repairs by unit
 *
 * @param {Array} repairs - Array of repair objects with equipment field
 * @returns {Object} Repairs grouped by unit ID
 *
 * Example:
 * {
 *   "RTU-6": [repair1, repair2],
 *   "RTU-2": [repair3]
 * }
 */
export function groupRepairsByUnit(repairs) {
  const grouped = {};

  for (const repair of repairs) {
    const unitId = repair.equipment || 'Unknown';

    if (!grouped[unitId]) {
      grouped[unitId] = [];
    }

    grouped[unitId].push(repair);
  }

  return grouped;
}

/**
 * Get unit type from unit ID
 *
 * @param {string} unitId - Unit identifier (e.g., "RTU-6")
 * @returns {string} Full unit type name
 *
 * Examples:
 *   "RTU-6" → "Rooftop Unit"
 *   "AHU-2" → "Air Handler"
 *   "FCU-3" → "Fan Coil Unit"
 *   "MAU-1" → "Makeup Air Unit"
 */
export function getUnitTypeName(unitId) {
  if (!unitId) return 'Unknown';

  const prefix = unitId.split('-')[0].toUpperCase();

  const typeMap = {
    'RTU': 'Rooftop Unit',
    'AHU': 'Air Handler',
    'FCU': 'Fan Coil Unit',
    'MAU': 'Makeup Air Unit'
  };

  return typeMap[prefix] || 'Equipment';
}

/**
 * Validate unit ID format
 *
 * @param {string} unitId - Unit identifier to validate
 * @returns {boolean} True if valid format
 */
export function isValidUnitId(unitId) {
  if (!unitId) return false;

  // Valid formats: RTU-1, AHU-12, FCU-3, MAU-1
  const pattern = /^(RTU|AHU|FCU|MAU)-\d+$/;
  return pattern.test(unitId);
}

/**
 * Normalize unit ID to standard format
 * Converts variations to standard format (e.g., "rtu1" → "RTU-1")
 *
 * @param {string} unitText - Unit text to normalize
 * @returns {string|null} Normalized unit ID or null if invalid
 */
export function normalizeUnitId(unitText) {
  if (!unitText) return null;

  const units = extractUnits(unitText);
  return units.length > 0 ? units[0] : null;
}
