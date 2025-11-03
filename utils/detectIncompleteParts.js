/**
 * Detect incomplete part specifications (CommonJS version for server.js)
 *
 * When a tech says "needs filters and batteries", the system must detect
 * that these are incomplete (missing size and type) and prompt for details.
 */

const { getPopularFilterSizes, validateFilterSize } = require('./filterSizeLookup');

/**
 * Check if a part string has complete specifications
 */
function detectIncompletePart(partString) {
  if (!partString) {
    return {
      isComplete: false,
      category: 'unknown',
      missingDetails: ['part name'],
      prompt: 'What part is needed?',
      confidence: 0
    };
  }

  const normalized = partString.toLowerCase().trim();

  // Check each part category
  const detectors = [
    detectFilter,
    detectBattery,
    detectContactor,
    detectCapacitor,
    detectRefrigerant,
    detectBelt,
    detectMotor,
    detectThermostat
  ];

  for (const detector of detectors) {
    const result = detector(normalized, partString);
    if (result.category !== 'unknown') {
      return result;
    }
  }

  // Check if it's "X lbs" or "X pounds" without refrigerant type (likely incomplete refrigerant)
  const quantityOnlyPattern = /^\d+(\.\d+)?\s*(lb|lbs|pound|pounds)$/i;
  if (quantityOnlyPattern.test(normalized.trim())) {
    return {
      isComplete: false,
      category: 'refrigerant',
      missingDetails: ['refrigerant type'],
      prompt: 'What type of refrigerant? (e.g., R-410A, R-22)',
      confidence: 0.8,
      originalText: partString
    };
  }

  // Generic part - assume complete if it has descriptive words
  return {
    isComplete: normalized.split(' ').length >= 2,
    category: 'generic',
    missingDetails: [],
    prompt: null,
    confidence: 0.5,
    originalText: partString
  };
}

/**
 * Detect filter specifications
 */
function detectFilter(normalized, original) {
  const filterKeywords = ['filter', 'filters', 'air filter'];
  const hasFilterKeyword = filterKeywords.some(kw => normalized.includes(kw));

  if (!hasFilterKeyword) {
    return { category: 'unknown' };
  }

  // Check for size pattern: 16x20x1, 24x24x2, "20 by 25 by 1", etc.
  const sizePattern = /\b(\d{1,2})\s*([xX×]|by)\s*(\d{1,2})\s*([xX×]|by)\s*(\d{1,2})\b/i;
  const hasSize = sizePattern.test(original);

  if (hasSize) {
    const match = original.match(sizePattern);
    const size = `${match[1]}x${match[3]}x${match[5]}`;

    // Validate against inventory
    const validFilter = validateFilterSize(size);

    if (validFilter) {
      // Filter exists in inventory
      return {
        isComplete: true,
        category: 'filter',
        size: size,
        validatedSize: validFilter.size,
        inStock: true,
        pricing: validFilter.pricing,
        merv: validFilter.merv,
        missingDetails: [],
        prompt: null,
        confidence: 0.95,
        originalText: original
      };
    } else {
      // Filter size mentioned but not in inventory
      return {
        isComplete: true,
        category: 'filter',
        size: size,
        inStock: false,
        warning: `${size} not found in standard inventory. Verify this size exists.`,
        missingDetails: [],
        prompt: null,
        confidence: 0.7,
        originalText: original
      };
    }
  }

  // No size specified - suggest popular sizes from inventory
  const popularSizes = getPopularFilterSizes();

  return {
    isComplete: false,
    category: 'filter',
    missingDetails: ['size'],
    prompt: 'What size filter? (e.g., ' + popularSizes.slice(0, 3).join(', ') + ')',
    confidence: 0.9,
    originalText: original,
    suggestions: popularSizes
  };
}

/**
 * Detect battery specifications
 */
function detectBattery(normalized, original) {
  const batteryKeywords = ['battery', 'batteries', 'cell', 'cells'];
  const hasBatteryKeyword = batteryKeywords.some(kw => normalized.includes(kw));

  if (!hasBatteryKeyword) {
    return { category: 'unknown' };
  }

  // Check for battery type
  const batteryTypes = ['aa', 'aaa', 'aaaa', '9v', '9 volt', 'c', 'd', 'cr2032', 'lithium'];
  const hasType = batteryTypes.some(type => {
    const typePattern = new RegExp(`\\b${type}\\b`, 'i');
    return typePattern.test(normalized);
  });

  if (hasType) {
    let detectedType = null;
    for (const type of batteryTypes) {
      const typePattern = new RegExp(`\\b${type}\\b`, 'i');
      if (typePattern.test(normalized)) {
        detectedType = type.toUpperCase();
        if (type === '9 volt') detectedType = '9V';
        break;
      }
    }

    return {
      isComplete: true,
      category: 'battery',
      batteryType: detectedType,
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  return {
    isComplete: false,
    category: 'battery',
    missingDetails: ['type'],
    prompt: 'What type of battery? (e.g., AA, AAA, 9V)',
    confidence: 0.9,
    originalText: original,
    suggestions: ['AA', 'AAA', '9V', 'C', 'D']
  };
}

/**
 * Detect contactor specifications
 */
function detectContactor(normalized, original) {
  const contactorKeywords = ['contactor', 'relay'];
  const hasContactorKeyword = contactorKeywords.some(kw => normalized.includes(kw));

  if (!hasContactorKeyword) {
    return { category: 'unknown' };
  }

  const polePattern = /\b([123])\s*pole|single\s*pole|double\s*pole|triple\s*pole\b/i;
  const hasPoles = polePattern.test(normalized);

  const voltagePattern = /\b(24|120|208|240|277|480)\s*v(olt)?\b/i;
  const hasVoltage = voltagePattern.test(normalized);

  if (hasPoles && hasVoltage) {
    return {
      isComplete: true,
      category: 'contactor',
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  const missing = [];
  if (!hasPoles) missing.push('poles');
  if (!hasVoltage) missing.push('voltage');

  return {
    isComplete: false,
    category: 'contactor',
    missingDetails: missing,
    prompt: `What are the contactor specs? (e.g., 2 pole 24V, 3 pole 208V)`,
    confidence: 0.9,
    originalText: original,
    suggestions: ['2 pole 24V', '2 pole 120V', '3 pole 208V', '3 pole 480V']
  };
}

/**
 * Detect capacitor specifications
 */
function detectCapacitor(normalized, original) {
  const capacitorKeywords = ['capacitor', 'cap', 'run cap', 'start cap', 'dual run'];
  const hasCapacitorKeyword = capacitorKeywords.some(kw => normalized.includes(kw));

  if (!hasCapacitorKeyword) {
    return { category: 'unknown' };
  }

  const mfdPattern = /\b(\d+([/.+]\d+)?)\s*(mfd|uf|microfarad|µf)\b/i;
  const hasMFD = mfdPattern.test(normalized);

  const voltagePattern = /\b(240|370|440)\s*v(olt)?\b/i;
  const hasVoltage = voltagePattern.test(normalized);

  if (hasMFD && hasVoltage) {
    return {
      isComplete: true,
      category: 'capacitor',
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  const missing = [];
  if (!hasMFD) missing.push('MFD rating');
  if (!hasVoltage) missing.push('voltage');

  return {
    isComplete: false,
    category: 'capacitor',
    missingDetails: missing,
    prompt: `What are the capacitor ratings? (e.g., 45/5 MFD 440V, 35 MFD 370V)`,
    confidence: 0.9,
    originalText: original,
    suggestions: ['45/5 MFD 440V', '35 MFD 370V', '40+5 MFD 440V', '5 MFD 240V']
  };
}

/**
 * Detect refrigerant specifications
 */
function detectRefrigerant(normalized, original) {
  const refrigerantKeywords = ['refrigerant', 'freon', 'charge', 'r-410a', 'r-22', 'r410a', 'r22'];
  const hasRefrigerantKeyword = refrigerantKeywords.some(kw => normalized.includes(kw));

  if (!hasRefrigerantKeyword) {
    return { category: 'unknown' };
  }

  const typePattern = /\br[-\s]?(410a|22|134a|404a|407c|32)\b/i;
  const hasType = typePattern.test(normalized);

  const quantityPattern = /\b(\d+(\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces)\b/i;
  const hasQuantity = quantityPattern.test(normalized);

  if (hasType && hasQuantity) {
    return {
      isComplete: true,
      category: 'refrigerant',
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  const missing = [];
  if (!hasType) missing.push('refrigerant type');
  if (!hasQuantity) missing.push('quantity');

  let prompt;
  if (!hasType && !hasQuantity) {
    prompt = 'How many pounds and what type of refrigerant? (e.g., 4 lbs R-410A)';
  } else if (!hasType) {
    prompt = 'What type of refrigerant? (e.g., R-410A, R-22)';
  } else {
    prompt = 'How many pounds?';
  }

  return {
    isComplete: false,
    category: 'refrigerant',
    missingDetails: missing,
    prompt: prompt,
    confidence: 0.9,
    originalText: original,
    suggestions: ['4 lbs R-410A', '2 lbs R-22', '3 lbs R-410A', '1.5 lbs R-410A']
  };
}

/**
 * Detect belt specifications
 */
function detectBelt(normalized, original) {
  const beltKeywords = ['belt', 'v-belt', 'v belt'];
  const hasBeltKeyword = beltKeywords.some(kw => normalized.includes(kw));

  if (!hasBeltKeyword) {
    return { category: 'unknown' };
  }

  const sizePattern = /\b(\d+\/\d+\s*[xX×]\s*\d+|[AB]\d+|[45]L\d+)\b/i;
  const hasSize = sizePattern.test(original);

  if (hasSize) {
    return {
      isComplete: true,
      category: 'belt',
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  return {
    isComplete: false,
    category: 'belt',
    missingDetails: ['size'],
    prompt: 'What belt size? (e.g., 5/8 x 54, A54, 4L540)',
    confidence: 0.85,
    originalText: original
  };
}

/**
 * Detect motor specifications
 */
function detectMotor(normalized, original) {
  const motorKeywords = ['motor', 'blower motor', 'fan motor', 'condenser motor'];
  const hasMotorKeyword = motorKeywords.some(kw => normalized.includes(kw));

  if (!hasMotorKeyword) {
    return { category: 'unknown' };
  }

  const hpPattern = /\b(\d+\/\d+|\d+)\s*hp\b/i;
  const hasHP = hpPattern.test(normalized);

  const voltagePattern = /\b(115|120|208|230|240|277|460|480)\s*v(olt)?\b/i;
  const hasVoltage = voltagePattern.test(normalized);

  const speedPattern = /\b(\d{3,4})\s*rpm\b/i;
  const hasSpeed = speedPattern.test(normalized);

  if (hasHP && hasVoltage && hasSpeed) {
    return {
      isComplete: true,
      category: 'motor',
      missingDetails: [],
      prompt: null,
      confidence: 0.95,
      originalText: original
    };
  }

  const missing = [];
  if (!hasHP) missing.push('horsepower');
  if (!hasVoltage) missing.push('voltage');
  if (!hasSpeed) missing.push('RPM');

  return {
    isComplete: false,
    category: 'motor',
    missingDetails: missing,
    prompt: 'What are the motor specs? (e.g., 1/2 HP 208-230V 1075 RPM)',
    confidence: 0.85,
    originalText: original
  };
}

/**
 * Detect thermostat specifications
 */
function detectThermostat(normalized, original) {
  const thermostatKeywords = ['thermostat', 'tstat', 't-stat'];
  const hasThermostatKeyword = thermostatKeywords.some(kw => normalized.includes(kw));

  if (!hasThermostatKeyword) {
    return { category: 'unknown' };
  }

  const typePattern = /\b(programmable|digital|mechanical|smart|wifi)\b/i;
  const hasType = typePattern.test(normalized);

  const stagePattern = /\b(\d+h\/\d+c|single\s*stage|multi\s*stage)\b/i;
  const hasStages = stagePattern.test(normalized);

  if (hasType || hasStages) {
    return {
      isComplete: true,
      category: 'thermostat',
      missingDetails: [],
      prompt: null,
      confidence: 0.85,
      originalText: original
    };
  }

  return {
    isComplete: false,
    category: 'thermostat',
    missingDetails: ['type or stages'],
    prompt: 'What type of thermostat? (e.g., programmable 2H/1C, digital single stage)',
    confidence: 0.8,
    originalText: original
  };
}

/**
 * Batch check multiple parts
 */
function detectIncompletePartsBatch(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map(part => detectIncompletePart(part));
}

/**
 * Get clarification questions for incomplete parts
 */
function getClarificationQuestions(detectionResults) {
  return detectionResults
    .filter(result => !result.isComplete && result.prompt)
    .map(result => result.prompt);
}

/**
 * Check if any parts are incomplete
 */
function hasIncompleteParts(detectionResults) {
  return detectionResults.some(result => !result.isComplete);
}

module.exports = {
  detectIncompletePart,
  detectIncompletePartsBatch,
  getClarificationQuestions,
  hasIncompleteParts
};
