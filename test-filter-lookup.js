/**
 * Test script for filter size lookup and validation
 * Run with: node test-filter-lookup.js
 */

const { detectIncompletePart } = require('./utils/detectIncompleteParts');
const { getPopularFilterSizes, validateFilterSize, getFilterPricing } = require('./utils/filterSizeLookup');

console.log('🧪 Testing Filter Size Lookup & Validation\n');
console.log('='.repeat(60));

// Test 1: Popular sizes
console.log('\n📋 Popular Filter Sizes:');
const popularSizes = getPopularFilterSizes();
console.log(popularSizes.join(', '));
console.log(`Total popular sizes: ${popularSizes.length}`);

// Test 2: Incomplete detection with inventory suggestions
console.log('\n\n⚠️  Test: Incomplete Filter Detection');
const incompleteResult = detectIncompletePart('filters');
console.log('Input: "filters"');
console.log(`Complete: ${incompleteResult.isComplete}`);
console.log(`Prompt: ${incompleteResult.prompt}`);
console.log(`Suggestions: ${incompleteResult.suggestions?.slice(0, 5).join(', ')}`);

// Test 3: Complete filter - in stock
console.log('\n\n✓ Test: Complete Filter (In Stock)');
const completeInStock = detectIncompletePart('24x24x2 filters');
console.log('Input: "24x24x2 filters"');
console.log(`Complete: ${completeInStock.isComplete}`);
console.log(`In Stock: ${completeInStock.inStock}`);
console.log(`Validated Size: ${completeInStock.validatedSize}`);
console.log(`MERV: ${completeInStock.merv}`);
if (completeInStock.pricing) {
  console.log(`Price (12 qty): $${completeInStock.pricing.tier1.price}`);
  console.log(`Price (36 qty): $${completeInStock.pricing.tier2.price}`);
  console.log(`Price (60+ qty): $${completeInStock.pricing.tier3.price}`);
}

// Test 4: Complete filter - spoken format
console.log('\n\n✓ Test: Complete Filter (Spoken Format)');
const completeSpoken = detectIncompletePart('20 by 25 by 1 filter');
console.log('Input: "20 by 25 by 1 filter"');
console.log(`Complete: ${completeSpoken.isComplete}`);
console.log(`In Stock: ${completeSpoken.inStock}`);
console.log(`Validated Size: ${completeSpoken.validatedSize}`);

// Test 5: Complete filter - NOT in stock
console.log('\n\n⚠️  Test: Complete Filter (NOT In Stock)');
const completeNotInStock = detectIncompletePart('30x30x1 filters');
console.log('Input: "30x30x1 filters" (non-standard size)');
console.log(`Complete: ${completeNotInStock.isComplete}`);
console.log(`In Stock: ${completeNotInStock.inStock}`);
console.log(`Warning: ${completeNotInStock.warning}`);

// Test 6: Pricing calculator
console.log('\n\n💰 Test: Pricing Calculator');
const pricing1 = getFilterPricing('24x24x2', 12);
console.log(`24x24x2 filters (qty: 12):`);
console.log(`  Unit Price: $${pricing1.unitPrice}`);
console.log(`  Total: $${pricing1.total}`);
console.log(`  Tier: ${pricing1.tier}`);

const pricing2 = getFilterPricing('24x24x2', 50);
console.log(`\n24x24x2 filters (qty: 50):`);
console.log(`  Unit Price: $${pricing2.unitPrice}`);
console.log(`  Total: $${pricing2.total}`);
console.log(`  Tier: ${pricing2.tier}`);

// Test 7: Validation
console.log('\n\n✓ Test: Direct Validation');
const valid = validateFilterSize('16x20x1');
if (valid) {
  console.log('16x20x1 is valid:');
  console.log(`  Size: ${valid.size}`);
  console.log(`  Popular: ${valid.popular || false}`);
  console.log(`  Case Qty: ${valid.qtyPerCase}`);
}

console.log('\n' + '='.repeat(60));
console.log('\n✅ All tests completed!');
