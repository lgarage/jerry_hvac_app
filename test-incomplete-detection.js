/**
 * Test script for incomplete part detection
 * Run with: node test-incomplete-detection.js
 */

const { detectIncompletePart, detectIncompletePartsBatch } = require('./utils/detectIncompleteParts');

console.log('🧪 Testing Incomplete Part Detection\n');
console.log('='.repeat(60));

const testCases = [
  // Filters
  { input: 'filters', expected: false, description: 'Filter without size' },
  { input: '24x24x2 filters', expected: true, description: 'Filter with size' },
  { input: '20 by 25 by 1 filter', expected: true, description: 'Filter with size (spoken)' },

  // Batteries
  { input: 'batteries', expected: false, description: 'Battery without type' },
  { input: 'AA batteries', expected: true, description: 'Battery with type' },
  { input: '4 AA batteries', expected: true, description: 'Battery with quantity and type' },
  { input: '9V battery', expected: true, description: '9V battery' },

  // Contactors
  { input: 'contactor', expected: false, description: 'Contactor without specs' },
  { input: '2 pole contactor', expected: false, description: 'Contactor missing voltage' },
  { input: '2 pole 24V contactor', expected: true, description: 'Complete contactor' },

  // Capacitors
  { input: 'capacitor', expected: false, description: 'Capacitor without specs' },
  { input: '45 MFD capacitor', expected: false, description: 'Capacitor missing voltage' },
  { input: '45/5 MFD 440V capacitor', expected: true, description: 'Complete dual run capacitor' },

  // Refrigerant
  { input: 'refrigerant', expected: false, description: 'Refrigerant without type/quantity' },
  { input: 'R-410A', expected: false, description: 'Refrigerant without quantity' },
  { input: '4 lbs', expected: false, description: 'Quantity without refrigerant type' },
  { input: '4 lbs R-410A', expected: true, description: 'Complete refrigerant' },
  { input: '2 pounds R-22', expected: true, description: 'Complete refrigerant (spelled out)' },

  // Belts
  { input: 'belt', expected: false, description: 'Belt without size' },
  { input: '5/8 x 54 belt', expected: true, description: 'Belt with size' },
  { input: 'A54 belt', expected: true, description: 'Belt with part number' },

  // Motors
  { input: 'motor', expected: false, description: 'Motor without specs' },
  { input: '1/2 HP motor', expected: false, description: 'Motor missing voltage/speed' },
  { input: '1/2 HP 208-230V 1075 RPM motor', expected: true, description: 'Complete motor' },
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = detectIncompletePart(testCase.input);
  const isComplete = result.isComplete;
  const matches = isComplete === testCase.expected;

  if (matches) {
    console.log(`✓ PASS: ${testCase.description}`);
    console.log(`  Input: "${testCase.input}"`);
    console.log(`  Complete: ${isComplete} (expected: ${testCase.expected})`);
    if (!isComplete) {
      console.log(`  Prompt: ${result.prompt}`);
    }
    passed++;
  } else {
    console.log(`✗ FAIL: ${testCase.description}`);
    console.log(`  Input: "${testCase.input}"`);
    console.log(`  Complete: ${isComplete} (expected: ${testCase.expected})`);
    console.log(`  Category: ${result.category}`);
    console.log(`  Missing: ${result.missingDetails?.join(', ') || 'none'}`);
    console.log(`  Prompt: ${result.prompt || 'none'}`);
    failed++;
  }
  console.log('');
}

console.log('='.repeat(60));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
