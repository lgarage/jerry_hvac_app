# PDF Upload UI

Implement and refine the PDF upload flow in the Jerry HVAC app, including cancel behavior and navigation.

## Objective

Enhance the Jerry HVAC app with a clear, user-friendly PDF upload workflow that supports both:

1. Uploading HVAC equipment manuals (for model-specific reference)
2. Uploading PDFs for terminology parsing and training

## User Flow Overview

### 1. Entry point
- The main Jerry HVAC screen must include a visible button labeled **"Upload PDF"**.
- This button opens the PDF upload dialog/screen.

### 2. Before upload begins
- Display **"Select PDF"** and **"Cancel"** buttons.
- If the user presses **Cancel** here, navigate back to the main Jerry HVAC screen (no confirmation needed).

### 3. While processing
- Once a PDF is uploaded and processing begins, display:
  - Progress indicator (e.g., spinner or progress bar)
  - **"Cancel Upload"** button
- If the user presses **Cancel Upload** during processing:
  - Prompt: "Are you sure you want to cancel this upload?"
  - If confirmed → stop the upload/processing task, delete any partial file from Supabase storage, and return to main screen.

### 4. Upload completion
- When processing finishes successfully, show a short status message ("✅ PDF processed successfully") and a **Back to Home** or **View Results** button.

## Future Context (for architecture)

- Each uploaded manual may later be **linked to specific HVAC model and serial numbers**.
- Initial phase: allow general uploads without linking.
- Future phase: add a dropdown or lookup to tie a manual to an equipment record (e.g., model number, customer site).

## Implementation Notes

- Use Supabase Storage bucket `manuals/` for uploads.
- Track processing state: `idle → uploading → processing → complete | canceled`.
- Make cancel button behavior conditional based on state.
- Provide clear navigation paths back to the main Jerry HVAC screen after any cancel or completion state.

## Deliverables

- Front-end UI component(s) implementing this flow.
- Server/Edge Function hook to stop or cancel a processing job safely.
- UI prompt/confirmation dialogs consistent with Jerry HVAC's existing design language.

## Usage

When user asks to:
- "Implement the PDF upload flow"
- "Add PDF upload UI"
- "Fix the PDF upload cancel behavior"
- "Improve the PDF upload UX"

## Steps

1. Review current PDF upload implementation in public/pdf-admin.html
2. Check existing upload endpoints in server.js
3. Implement state management for upload flow (idle → uploading → processing → complete)
4. Add "Upload PDF" button to main Jerry HVAC screen
5. Implement cancel confirmation dialog with proper cleanup
6. Add progress indicators during processing
7. Ensure navigation back to main screen works correctly
8. Test cancel behavior during different stages
9. Verify Supabase storage cleanup on cancel

## Expected Output

- Functional PDF upload UI with clear state transitions
- Cancel functionality that properly cleans up partial uploads
- Clear navigation paths throughout the flow
- User confirmation dialogs where appropriate
