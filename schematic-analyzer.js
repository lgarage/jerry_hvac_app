// Schematic Analysis Module - Uses Fireworks Llama4 Maverick for HVAC schematic vision analysis
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { fromPath } = require('pdf2pic');
const Fireworks = require('@fireworks-ai/fireworks-ai').default;
const { sql } = require('./db');

const fireworks = new Fireworks({
  apiKey: process.env.FIREWORKS_API_KEY
});

const LLAMA4_MODEL = 'accounts/fireworks/models/llama4-maverick-instruct-basic';

/**
 * Extract images from PDF pages for vision analysis
 */
async function extractImagesFromPDF(pdfPath, outputDir = './temp_schematics') {
  console.log(`📄 Extracting images from PDF: ${path.basename(pdfPath)}`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const converter = fromPath(pdfPath, {
      density: 300,        // 300 DPI for high quality
      saveFilename: path.basename(pdfPath, '.pdf'),
      savePath: outputDir,
      format: 'png',
      width: 4096,         // Llama4 supports up to 4096x4096
      height: 4096
    });

    // Get PDF page count first
    const PDFParser = require('pdf-parse');
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await PDFParser(dataBuffer);
    const numPages = data.numpages;

    console.log(`📊 PDF has ${numPages} pages, extracting images...`);

    const images = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const pageImage = await converter(pageNum, { responseType: 'image' });

        images.push({
          pageNumber: pageNum,
          path: pageImage.path,
          name: pageImage.name
        });

        console.log(`  ✓ Extracted page ${pageNum}/${numPages}`);
      } catch (pageError) {
        console.error(`  ✗ Failed to extract page ${pageNum}:`, pageError.message);
      }
    }

    console.log(`✓ Extracted ${images.length}/${numPages} page images`);
    return images;

  } catch (error) {
    console.error('Error extracting images from PDF:', error);
    throw error;
  }
}

/**
 * Analyze a single page image for HVAC schematic content
 */
async function analyzePageImage(imagePath, pageNumber) {
  console.log(`🔍 Analyzing page ${pageNumber} for schematics...`);

  try {
    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const imageUrl = `data:image/png;base64,${base64Image}`;

    // Prompt for schematic analysis
    const prompt = `Analyze this HVAC manual page image.

TASK 1: Determine if this page contains a schematic diagram (wiring diagram, refrigerant flow diagram, or control circuit).

TASK 2: If schematic detected, extract structured data:
- Component names and part numbers
- Wire colors, gauges, and terminal connections
- Voltage/amperage ratings
- Component relationships

Return JSON in this EXACT format:
{
  "schematic_detected": true/false,
  "detection_confidence": 0.0-1.0,
  "schematic_type": "wiring_diagram" OR "refrigerant_flow" OR "control_circuit" OR "unknown",
  "components": [
    {
      "name": "component name",
      "part_number": "part number or null",
      "type": "compressor|contactor|capacitor|fan|sensor|other",
      "confidence": 0.0-1.0,
      "voltage_rating": "240V or null",
      "amperage_rating": "30A or null",
      "connections": [
        {
          "terminal": "L1",
          "wire": {
            "color": "red",
            "gauge": "10 AWG"
          }
        }
      ]
    }
  ],
  "wires": [
    {
      "id": "W1",
      "color": "red",
      "gauge": "10 AWG",
      "connections": [
        {
          "component": "Compressor",
          "terminal": "L1"
        },
        {
          "component": "Contactor",
          "terminal": "T1"
        }
      ]
    }
  ]
}

If NO schematic detected, return:
{
  "schematic_detected": false,
  "detection_confidence": 0.0-1.0,
  "components": [],
  "wires": []
}`;

    // Call Fireworks Llama4 Maverick vision API
    const response = await fireworks.chat.completions.create({
      model: LLAMA4_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      temperature: 0.1, // Low temperature for consistent structured output
      max_tokens: 4000
    });

    const content = response.choices[0].message.content;

    // Parse JSON from response
    let result;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error(`  ⚠️  Failed to parse JSON response for page ${pageNumber}`);
      console.error(`  Raw response: ${content.substring(0, 200)}...`);
      return {
        schematic_detected: false,
        detection_confidence: 0.0,
        components: [],
        wires: [],
        error: 'Failed to parse JSON response'
      };
    }

    if (result.schematic_detected) {
      console.log(`  ✓ Schematic detected (${result.schematic_type}) with ${result.components?.length || 0} components`);
    } else {
      console.log(`  ○ No schematic detected on page ${pageNumber}`);
    }

    return result;

  } catch (error) {
    console.error(`  ✗ Error analyzing page ${pageNumber}:`, error.message);
    return {
      schematic_detected: false,
      detection_confidence: 0.0,
      components: [],
      wires: [],
      error: error.message
    };
  }
}

/**
 * Store schematic data in database
 */
async function storeSchematicData(manualId, pageNumber, imagePath, analysisResult) {
  if (!analysisResult.schematic_detected || analysisResult.detection_confidence < 0.5) {
    // Don't store if not a schematic or low confidence
    return null;
  }

  try {
    // Insert schematic record
    const schematic = await sql`
      INSERT INTO manual_schematics (
        manual_id, page_number, schematic_type, detection_confidence, image_path, metadata
      ) VALUES (
        ${manualId}, ${pageNumber}, ${analysisResult.schematic_type || 'unknown'},
        ${analysisResult.detection_confidence}, ${imagePath},
        ${JSON.stringify(analysisResult)}
      )
      RETURNING id
    `;

    const schematicId = schematic[0].id;
    console.log(`  💾 Stored schematic ${schematicId} for page ${pageNumber}`);

    // Insert components
    const componentIds = new Map(); // Map component names to IDs for connections

    if (analysisResult.components && analysisResult.components.length > 0) {
      for (const comp of analysisResult.components) {
        try {
          const component = await sql`
            INSERT INTO schematic_components (
              schematic_id, component_name, part_number, component_type,
              confidence, voltage_rating, amperage_rating, metadata
            ) VALUES (
              ${schematicId}, ${comp.name}, ${comp.part_number || null},
              ${comp.type || 'other'}, ${comp.confidence || 0.8},
              ${comp.voltage_rating || null}, ${comp.amperage_rating || null},
              ${JSON.stringify(comp)}
            )
            ON CONFLICT (schematic_id, component_name, part_number) DO NOTHING
            RETURNING id
          `;

          if (component.length > 0) {
            componentIds.set(comp.name, component[0].id);
          }
        } catch (compError) {
          console.error(`    ⚠️  Error storing component ${comp.name}:`, compError.message);
        }
      }

      console.log(`    ✓ Stored ${componentIds.size} components`);
    }

    // Insert wire connections
    if (analysisResult.wires && analysisResult.wires.length > 0) {
      let connectionCount = 0;

      for (const wire of analysisResult.wires) {
        if (!wire.connections || wire.connections.length < 2) continue;

        // Create connections between components
        for (let i = 0; i < wire.connections.length - 1; i++) {
          const fromConn = wire.connections[i];
          const toConn = wire.connections[i + 1];

          const fromCompId = componentIds.get(fromConn.component);
          const toCompId = componentIds.get(toConn.component);

          if (fromCompId && toCompId) {
            try {
              await sql`
                INSERT INTO schematic_connections (
                  schematic_id, wire_id, from_component_id, to_component_id,
                  wire_color, wire_gauge, from_terminal, to_terminal, metadata
                ) VALUES (
                  ${schematicId}, ${wire.id || null}, ${fromCompId}, ${toCompId},
                  ${wire.color || null}, ${wire.gauge || null},
                  ${fromConn.terminal || null}, ${toConn.terminal || null},
                  ${JSON.stringify(wire)}
                )
              `;
              connectionCount++;
            } catch (connError) {
              console.error(`    ⚠️  Error storing connection:`, connError.message);
            }
          }
        }
      }

      if (connectionCount > 0) {
        console.log(`    ✓ Stored ${connectionCount} connections`);
      }
    }

    return schematicId;

  } catch (error) {
    console.error(`  ✗ Error storing schematic data:`, error);
    throw error;
  }
}

/**
 * Main function: Analyze all pages in a PDF for schematics
 */
async function analyzePDFSchematics(pdfPath, manualId) {
  console.log('\n🔬 Starting schematic analysis...');

  try {
    // Extract images from PDF
    const images = await extractImagesFromPDF(pdfPath);

    if (images.length === 0) {
      console.log('⚠️  No images extracted from PDF');
      return { success: false, schematicsFound: 0 };
    }

    // Analyze each page
    const results = [];
    let schematicsFound = 0;

    for (const image of images) {
      const analysis = await analyzePageImage(image.path, image.pageNumber);

      if (analysis.schematic_detected && analysis.detection_confidence >= 0.5) {
        // Store in database
        const schematicId = await storeSchematicData(
          manualId,
          image.pageNumber,
          image.path,
          analysis
        );

        if (schematicId) {
          schematicsFound++;
        }
      }

      results.push({
        pageNumber: image.pageNumber,
        detected: analysis.schematic_detected,
        confidence: analysis.detection_confidence,
        type: analysis.schematic_type,
        componentsCount: analysis.components?.length || 0
      });

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n✅ Schematic analysis complete: ${schematicsFound} schematics found`);

    return {
      success: true,
      schematicsFound,
      totalPages: images.length,
      results
    };

  } catch (error) {
    console.error('❌ Schematic analysis failed:', error);
    return {
      success: false,
      error: error.message,
      schematicsFound: 0
    };
  }
}

module.exports = {
  extractImagesFromPDF,
  analyzePageImage,
  storeSchematicData,
  analyzePDFSchematics
};
