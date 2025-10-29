---
name: pdf-upload-ui
description: Implement and refine the PDF upload flow in the Jerry HVAC app, including cancel behavior and navigation.
---

# PDF Upload & Processing Flow — Specification

## Objective

Enhance the Jerry HVAC app with a clear, user-friendly PDF upload workflow that supports both:

1. Uploading HVAC equipment manuals (for model-specific reference)
2. Uploading PDFs for terminology parsing and training

## User Flow Overview

1. **Entry point**

   - The main Jerry HVAC screen must include a visible button labeled **“Upload PDF”**.
   - This button opens the PDF upload dialog/screen.

2. **Before upload begins**

   - Display **“Select PDF”** and **“Cancel”** buttons.
   - If the user presses **Cancel** here, navigate back to the main Jerry HVAC screen (no confirmation needed).

3. **While processing**

   - Once a PDF is uploaded and processing begins, display:
     - Progress indicator (e.g., spinner or progress bar)
     - **“Cancel Upload”** button
   - If the user presses **Cancel Upload** during processing:
     - Prompt: “Are you sure you want to cancel this upload?”
     - If confirmed → stop the upload/processing task, delete any partial file from Supabase storage, and return to main screen.

4. **Upload completion**
   - When processing finishes successfully, show a short status message (“✅ PDF processed successfully”) and a **Back to Home** or **View Results** button.

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
- UI prompt/confirmation dialogs consistent with Jerry HVAC’s existing design language.
