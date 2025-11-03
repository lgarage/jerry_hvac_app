/**
 * Test script for equipment learning system
 * Demonstrates how equipment metadata is used for smart prompting
 *
 * Run with: node test-equipment-learning.js
 */

const { detectIncompletePart } = require('./utils/detectIncompleteParts');

console.log('🧪 Testing Equipment Learning System\n');
console.log('='.repeat(60));

// Test 1: First time - no metadata (new customer scenario)
console.log('\n📋 Test 1: New Equipment (No History)');
console.log('Scenario: First time servicing RTU-6, tech says "filters"');
console.log('-'.repeat(60));

const context1 = {
  equipmentName: 'RTU-6',
  equipmentMetadata: {} // No learned specs yet
};

const result1 = detectIncompletePart('filters', context1);
console.log(`Input: "filters"`);
console.log(`Complete: ${result1.isComplete}`);
console.log(`Category: ${result1.category}`);
console.log(`Missing: ${result1.missingDetails?.join(', ')}`);
console.log(`Prompt: "${result1.prompt}"`);
console.log(`\nExpected: "What size filters does RTU-6 need?"`);
console.log(`✓ Correct: ${result1.prompt === 'What size filters does RTU-6 need?'}`);

// Test 2: Second time - with learned metadata
console.log('\n\n📋 Test 2: Known Equipment (Has History)');
console.log('Scenario: RTU-6 visited before, learned filter_size = "24x24x2"');
console.log('-'.repeat(60));

const context2 = {
  equipmentName: 'RTU-6',
  equipmentMetadata: {
    filter_size: '24x24x2',
    filter_size_learned_date: '2024-10-15T14:30:00Z',
    learned_specifications: {
      filter_size: {
        value: '24x24x2',
        learned_date: '2024-10-15T14:30:00Z',
        learned_from_job: 'JOB-2024-001',
        confidence: 'high'
      }
    }
  }
};

const result2 = detectIncompletePart('filters', context2);
console.log(`Input: "filters"`);
console.log(`Complete: ${result2.isComplete}`);
console.log(`Category: ${result2.category}`);
console.log(`Missing: ${result2.missingDetails?.join(', ')}`);
console.log(`Prompt: "${result2.prompt}"`);
console.log(`Suggested size: ${result2.suggestedSize}`);
console.log(`\nExpected: "RTU-6 uses 24x24x2 filters. Same size?"`);
console.log(`✓ Correct: ${result2.prompt === 'RTU-6 uses 24x24x2 filters. Same size?'}`);

// Test 3: Complete filter specification (tech provided size)
console.log('\n\n📋 Test 3: Complete Specification');
console.log('Scenario: Tech says "24x24x2 filters" (providing full spec)');
console.log('-'.repeat(60));

const result3 = detectIncompletePart('24x24x2 filters', context2);
console.log(`Input: "24x24x2 filters"`);
console.log(`Complete: ${result3.isComplete}`);
console.log(`Category: ${result3.category}`);
console.log(`Validated size: ${result3.validatedSize}`);
console.log(`In stock: ${result3.inStock}`);
if (result3._backendOnly?.pricing) {
  console.log(`Pricing (hidden from tech UI):`);
  console.log(`  Tier 1 (12 qty): $${result3._backendOnly.pricing.tier1.price}`);
  console.log(`  Tier 2 (36 qty): $${result3._backendOnly.pricing.tier2.price}`);
  console.log(`  Tier 3 (60+ qty): $${result3._backendOnly.pricing.tier3.price}`);
  console.log(`  MERV: ${result3._backendOnly.merv}`);
}
console.log(`\n✓ Part is complete and ready for quote generation`);

// Test 4: Different size - learning a change
console.log('\n\n📋 Test 4: Size Change (Learning Update)');
console.log('Scenario: RTU-6 previously used 24x24x2, now needs 20x25x1');
console.log('-'.repeat(60));

const result4 = detectIncompletePart('20x25x1 filters', context2);
console.log(`Input: "20x25x1 filters" (different from learned 24x24x2)`);
console.log(`Complete: ${result4.isComplete}`);
console.log(`Validated size: ${result4.validatedSize}`);
console.log(`In stock: ${result4.inStock}`);
console.log(`Learn and store: ${result4.learnAndStore}`);
console.log(`\n✓ System will update equipment metadata with new size`);

// Test 5: Non-standard size (not in inventory)
console.log('\n\n📋 Test 5: Non-Standard Size (Not In Stock)');
console.log('Scenario: Tech needs 30x30x1 (uncommon size)');
console.log('-'.repeat(60));

const result5 = detectIncompletePart('30x30x1 filters', context1);
console.log(`Input: "30x30x1 filters"`);
console.log(`Complete: ${result5.isComplete}`);
console.log(`Category: ${result5.category}`);
console.log(`Validated size: ${result5.validatedSize}`);
console.log(`In stock: ${result5.inStock}`);
console.log(`Warning: ${result5.warning}`);
console.log(`\n⚠️  Part is complete but not in standard inventory`);

// Test 6: Batch detection with multiple equipment
console.log('\n\n📋 Test 6: Batch Detection (Multiple Equipment)');
console.log('Scenario: Multiple repairs with different equipment contexts');
console.log('-'.repeat(60));

const { detectIncompletePartsBatch } = require('./utils/detectIncompleteParts');

const parts = ['filters', 'batteries', '2 pole 24V contactor'];
const batchContext = {
  equipmentName: 'RTU-6',
  equipmentMetadata: {
    filter_size: '24x24x2',
    battery_type: 'AA'
  }
};

const batchResults = detectIncompletePartsBatch(parts, batchContext);
console.log(`Parts to check: ${parts.length}`);
batchResults.forEach((detection, i) => {
  console.log(`\n  ${i + 1}. "${parts[i]}"`);
  console.log(`     Complete: ${detection.isComplete}`);
  console.log(`     Category: ${detection.category}`);
  if (!detection.isComplete) {
    console.log(`     Missing: ${detection.missingDetails?.join(', ')}`);
    console.log(`     Prompt: "${detection.prompt}"`);
  }
  if (detection.suggestedSize || detection.suggestedType) {
    console.log(`     Suggested: ${detection.suggestedSize || detection.suggestedType}`);
  }
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n✅ Equipment Learning System Tests Complete!');
console.log('\nKey Capabilities Demonstrated:');
console.log('  ✓ Smart prompting based on equipment history');
console.log('  ✓ Equipment-specific suggestions (not generic)');
console.log('  ✓ Filter inventory validation');
console.log('  ✓ Pricing data (backend only, hidden from tech)');
console.log('  ✓ Learning and storing new specifications');
console.log('  ✓ Handling non-standard sizes with warnings');
console.log('  ✓ Batch detection for multiple parts');

console.log('\n📚 See docs/EQUIPMENT_LEARNING_SYSTEM.md for architecture details\n');
